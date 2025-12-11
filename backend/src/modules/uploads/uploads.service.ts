import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';
import { QueueAdapter } from '../../infrastructure/adapters/queue/queue.adapter';
import * as crypto from 'crypto';

/**
 * Interface para metadados de áudio extraídos
 */
export interface AudioMetadata {
  duration: number; // segundos
  bitrate: number;
  sampleRate: number;
  channels: number;
}

/**
 * Interface para resposta de upload bem-sucedido
 */
export interface UploadResponse {
  transcriptionId: string;
  audioFileId: string;
  audioUrl: string;
  status: 'pending';
  message: string;
  estimatedProcessingTime: string;
}

/**
 * Interface para configuração de upload
 */
export interface UploadConfig {
  maxDurationSeconds: number;
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  allowedFormats: string[];
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly uploadConfig: UploadConfig;

  constructor(
    private firebaseAdapter: FirebaseAdapter,
    private queueAdapter: QueueAdapter,
    private configService: ConfigService,
  ) {
    // Configuração padrão de upload
    this.uploadConfig = {
      maxDurationSeconds: parseInt(
        this.configService.get('MAX_AUDIO_DURATION', '1800'),
        10,
      ), // 30 minutos
      maxFileSizeBytes: parseInt(
        this.configService.get('MAX_FILE_SIZE', '314572800'),
        10,
      ), // 300 MB
      allowedMimeTypes: [
        'audio/mpeg',
        'audio/wav',
        'audio/mp4',
        'audio/ogg',
        'audio/webm',
      ],
      allowedFormats: ['mp3', 'wav', 'm4a', 'opus', 'ogg', 'webm'],
    };
  }

  /**
   * Faz upload de arquivo de áudio para Firebase Storage
   * Valida formato, duração e tamanho
   * Enfileira job de transcrição
   *
   * @param userId - ID do usuário (Firebase UID)
   * @param file - Arquivo de áudio do Express Multer
   * @returns UploadResponse com ID da transcrição e status
   * @throws BadRequestException se validação falhar
   * @throws InternalServerErrorException se upload falhar
   */
  async uploadAudio(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UploadResponse> {
    try {
      // 1. Validar arquivo
      this.validateFile(file);

      // 2. Extrair metadados de áudio (simulado - em produção usar ffprobe)
      const audioMetadata = await this.extractAudioMetadata(file.buffer);

      // 3. Validar duração
      if (audioMetadata.duration > this.uploadConfig.maxDurationSeconds) {
        throw new BadRequestException(
          `Áudio excede duração máxima de ${this.uploadConfig.maxDurationSeconds / 60} minutos. Duração atual: ${(audioMetadata.duration / 60).toFixed(2)} minutos.`,
        );
      }

      // 4. Gerar ID único para arquivo
      const audioFileId = this.generateAudioFileId(userId, file.originalname);

      // 5. Upload para Firebase Storage
      this.logger.log(`Iniciando upload de ${file.originalname} para Firebase`);
      const audioUrl = await this.firebaseAdapter.uploadFile(
        audioFileId,
        file.buffer,
        file.mimetype,
      );
      this.logger.log(`Upload concluído: ${audioUrl}`);

      // 6. Criar documento de transcrição em Firestore
      const audioFormat = this.getAudioFormat(file.mimetype);
      const transcription = await this.firebaseAdapter.createTranscription({
        userId,
        audioFileId,
        audioUrl,
        audioFormat,
        durationSeconds: audioMetadata.duration,
        status: 'pending',
        transcriptText: '',
        segments: [],
        confidence: 0,
        provider: this.configService.get('ASR_PROVIDER', 'google-cloud-speech'),
        isPurchased: false,
        purchasePrice: this.calculatePrice(audioMetadata.duration),
        createdAt: new Date(),
      });

      this.logger.log(
        `Transcrição criada: ${transcription.id} para usuário ${userId}`,
      );

      // 7. Enfileirar job de transcrição
      await this.queueAdapter.enqueueTranscriptionJob({
        transcriptionId: transcription.id,
        userId,
        audioUrl,
        audioFormat,
        durationSeconds: audioMetadata.duration,
        audioFileId,
      });

      this.logger.log(
        `Job de transcrição enfileirado: ${transcription.id}`,
      );

      // 8. Retornar resposta de sucesso
      return {
        transcriptionId: transcription.id,
        audioFileId,
        audioUrl,
        status: 'pending',
        message: `Áudio enviado com sucesso. Transcrição será processada em breve.`,
        estimatedProcessingTime: this.estimateProcessingTime(
          audioMetadata.duration,
        ),
      };
    } catch (error) {
      this.logger.error(
        `Erro ao fazer upload de áudio: ${error.message}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Erro ao fazer upload de áudio. Tente novamente mais tarde.',
      );
    }
  }

  /**
   * Valida arquivo de áudio
   * Verifica MIME type, tamanho e extensão
   *
   * @param file - Arquivo a validar
   * @throws BadRequestException se validação falhar
   */
  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi fornecido');
    }

    // Validar MIME type
    if (!this.uploadConfig.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Formato de áudio não suportado: ${file.mimetype}. Formatos aceitos: ${this.uploadConfig.allowedFormats.join(', ')}`,
      );
    }

    // Validar tamanho do arquivo
    if (file.size > this.uploadConfig.maxFileSizeBytes) {
      const maxSizeMB = (this.uploadConfig.maxFileSizeBytes / 1024 / 1024).toFixed(0);
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      throw new BadRequestException(
        `Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB. Tamanho atual: ${fileSizeMB}MB`,
      );
    }

    // Validar extensão do arquivo
    const fileExtension = this.getFileExtension(file.originalname);
    if (!this.uploadConfig.allowedFormats.includes(fileExtension)) {
      throw new BadRequestException(
        `Extensão de arquivo não suportada: .${fileExtension}`,
      );
    }

    this.logger.debug(
      `Arquivo validado: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
    );
  }

  /**
   * Extrai metadados de áudio do buffer
   * Em produção, usar ffprobe para análise real
   * Por enquanto, retorna valores estimados
   *
   * @param buffer - Buffer do arquivo de áudio
   * @returns AudioMetadata com duração e outras informações
   */
  private async extractAudioMetadata(buffer: Buffer): Promise<AudioMetadata> {
    try {
      // Nota: Em produção, usar ffprobe ou biblioteca similar
      // Exemplo com ffprobe:
      // const metadata = await ffprobe(buffer);
      // return {
      //   duration: metadata.streams[0].duration,
      //   bitrate: metadata.streams[0].bit_rate,
      //   sampleRate: metadata.streams[0].sample_rate,
      //   channels: metadata.streams[0].channels,
      // };

      // Por enquanto, estimar duração baseado no tamanho do arquivo
      // Aproximação: 128 kbps = 16 KB/s
      const estimatedDuration = Math.ceil(buffer.length / 16000);

      return {
        duration: estimatedDuration,
        bitrate: 128000,
        sampleRate: 44100,
        channels: 2,
      };
    } catch (error) {
      this.logger.warn(
        `Erro ao extrair metadados de áudio: ${error.message}`,
      );
      // Retornar valores padrão se falhar
      return {
        duration: 0,
        bitrate: 128000,
        sampleRate: 44100,
        channels: 2,
      };
    }
  }

  /**
   * Gera ID único para arquivo de áudio
   * Formato: audio/{userId}/{timestamp}-{hash}-{originalName}
   *
   * @param userId - ID do usuário
   * @param originalName - Nome original do arquivo
   * @returns ID único para armazenamento
   */
  private generateAudioFileId(userId: string, originalName: string): string {
    const timestamp = Date.now();
    const hash = crypto.randomBytes(8).toString('hex');
    const sanitizedName = originalName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .toLowerCase();

    return `audio/${userId}/${timestamp}-${hash}-${sanitizedName}`;
  }

  /**
   * Extrai extensão do arquivo
   *
   * @param filename - Nome do arquivo
   * @returns Extensão em minúsculas (sem ponto)
   */
  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  /**
   * Mapeia MIME type para formato de áudio
   *
   * @param mimeType - MIME type do arquivo
   * @returns Formato de áudio (mp3, wav, m4a, opus, etc)
   */
  private getAudioFormat(
    mimeType: string,
  ): 'mp3' | 'wav' | 'm4a' | 'opus' | 'ogg' | 'webm' {
    const formatMap: Record<string, any> = {
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
      'audio/opus': 'opus',
      'audio/webm': 'webm',
    };

    return formatMap[mimeType] || 'mp3';
  }

  /**
   * Calcula preço de transcrição baseado na duração
   * Preço: $0.02 por minuto (ajustável)
   *
   * @param durationSeconds - Duração em segundos
   * @returns Preço em centavos (USD)
   */
  private calculatePrice(durationSeconds: number): number {
    const pricePerMinute = parseInt(
      this.configService.get('PRICE_PER_MINUTE', '2'),
      10,
    ); // 2 centavos por minuto
    const durationMinutes = Math.ceil(durationSeconds / 60);
    return durationMinutes * pricePerMinute;
  }

  /**
   * Estima tempo de processamento baseado na duração
   * Aproximação: 1 minuto de áudio = 30 segundos de processamento
   *
   * @param durationSeconds - Duração em segundos
   * @returns String descritiva do tempo estimado
   */
  private estimateProcessingTime(durationSeconds: number): string {
    const estimatedSeconds = Math.ceil(durationSeconds / 2);

    if (estimatedSeconds < 60) {
      return `Menos de 1 minuto`;
    } else if (estimatedSeconds < 300) {
      const minutes = Math.ceil(estimatedSeconds / 60);
      return `Cerca de ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else {
      const minutes = Math.ceil(estimatedSeconds / 60);
      return `Cerca de ${minutes} minutos`;
    }
  }

  /**
   * Obtém status de uma transcrição
   *
   * @param transcriptionId - ID da transcrição
   * @returns Documento de transcrição do Firestore
   */
  async getTranscriptionStatus(transcriptionId: string) {
    try {
      const transcription =
        await this.firebaseAdapter.getTranscription(transcriptionId);

      if (!transcription) {
        throw new BadRequestException(
          `Transcrição ${transcriptionId} não encontrada`,
        );
      }

      return {
        id: transcription.id,
        status: transcription.status,
        transcriptText: transcription.transcriptText,
        confidence: transcription.confidence,
        createdAt: transcription.createdAt,
        completedAt: transcription.completedAt,
        errorMessage: transcription.errorMessage,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao obter status da transcrição: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Lista transcrições do usuário com paginação
   *
   * @param userId - ID do usuário
   * @param limit - Número máximo de resultados
   * @param offset - Número de resultados a pular
   * @returns Array de transcrições
   */
  async listUserTranscriptions(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ) {
    try {
      // Nota: Implementar paginação em Firestore é diferente de SQL
      // Usar query com where, orderBy e limit
      const transcriptions =
        await this.firebaseAdapter.getUserTranscriptions(userId, limit);

      return {
        data: transcriptions,
        total: transcriptions.length,
        limit,
        offset,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao listar transcrições do usuário: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Erro ao listar transcrições',
      );
    }
  }

  /**
   * Deleta uma transcrição e seu arquivo de áudio
   * Apenas o proprietário pode deletar
   *
   * @param transcriptionId - ID da transcrição
   * @param userId - ID do usuário (para validação de ownership)
   */
  async deleteTranscription(
    transcriptionId: string,
    userId: string,
  ): Promise<void> {
    try {
      const transcription =
        await this.firebaseAdapter.getTranscription(transcriptionId);

      if (!transcription) {
        throw new BadRequestException(
          `Transcrição ${transcriptionId} não encontrada`,
        );
      }

      if (transcription.userId !== userId) {
        throw new BadRequestException(
          'Você não tem permissão para deletar esta transcrição',
        );
      }

      // Deletar arquivo de áudio do Firebase Storage
      await this.firebaseAdapter.deleteFile(transcription.audioFileId);

      // Deletar documento de transcrição do Firestore
      await this.firebaseAdapter.deleteTranscription(transcriptionId);

      this.logger.log(
        `Transcrição ${transcriptionId} deletada pelo usuário ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Erro ao deletar transcrição: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Retorna configuração de upload atual
   * Útil para frontend saber limites
   *
   * @returns UploadConfig com limites e formatos aceitos
   */
  getUploadConfig(): UploadConfig {
    return this.uploadConfig;
  }
}
