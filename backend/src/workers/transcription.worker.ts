import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseAdapter } from '../infrastructure/adapters/firebase/firebase.adapter';
import { AsrAdapter } from '../infrastructure/adapters/asr/asr.adapter';
import { QueueAdapter, TranscriptionJob, TranscriptionJobResult } from '../infrastructure/adapters/queue/queue.adapter';
import * as https from 'https';

/**
 * Interface para segmento de transcrição
 */
export interface TranscriptSegment {
  startTime: number; // segundos
  endTime: number; // segundos
  text: string;
  confidence: number; // 0-1
  speaker?: string; // Opcional: identificação de falante
}

/**
 * Interface para resultado de transcrição do ASR
 */
export interface AsrTranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  confidence: number;
  duration: number;
  language: string;
  provider: string;
}

/**
 * Worker para processar jobs de transcrição
 * Responsável por:
 * 1. Consumir jobs da fila
 * 2. Baixar áudio do Firebase Storage
 * 3. Chamar Google Cloud Speech-to-Text
 * 4. Salvar transcrição em Firestore
 * 5. Notificar usuário
 */
@Injectable()
export class TranscriptionWorker {
  private readonly logger = new Logger(TranscriptionWorker.name);

  constructor(
    private firebaseAdapter: FirebaseAdapter,
    private asrAdapter: AsrAdapter,
    private queueAdapter: QueueAdapter,
    private configService: ConfigService,
  ) {
    this.initializeWorker();
  }

  /**
   * Inicializa o worker e registra o processor
   * Chamado automaticamente quando o serviço é instanciado
   */
  private initializeWorker(): void {
    try {
      this.queueAdapter.registerTranscriptionProcessor(
        this.processTranscription.bind(this),
      );
      this.logger.log('Transcription Worker inicializado com sucesso');
    } catch (error) {
      this.logger.error(
        `Erro ao inicializar Transcription Worker: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Processa um job de transcrição
   * Método principal do worker
   *
   * @param job - Job de transcrição da fila
   * @returns Resultado do processamento
   */
  async processTranscription(job: any): Promise<TranscriptionJobResult> {
    const startTime = Date.now();
    const data: TranscriptionJob = job.data;

    this.logger.log(
      `Iniciando processamento de transcrição: ${data.transcriptionId}`,
    );

    try {
      // 1. Atualizar status para "processing"
      await this.updateTranscriptionStatus(
        data.transcriptionId,
        'processing',
        null,
      );

      // 2. Baixar áudio do Firebase Storage
      this.logger.debug(
        `Baixando áudio: ${data.audioFileId}`,
      );
      const audioBuffer = await this.downloadAudioFile(data.audioUrl);

      // 3. Chamar Google Cloud Speech-to-Text
      this.logger.debug(
        `Chamando ASR provider: ${data.audioFormat}`,
      );
      const transcriptionResult = await this.asrAdapter.transcribe(
        audioBuffer,
        data.audioFormat,
        {
          languageCode: this.configService.get('ASR_LANGUAGE_CODE', 'pt-BR'),
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          enableSpeakerDiarization: this.configService.get(
            'ASR_ENABLE_DIARIZATION',
            'false',
          ) === 'true',
          maxAlternatives: 1,
        },
      );

      this.logger.debug(
        `Transcrição concluída: ${transcriptionResult.text.substring(0, 100)}...`,
      );

      // 4. Salvar transcrição em Firestore
      await this.updateTranscriptionStatus(
        data.transcriptionId,
        'completed',
        transcriptionResult,
      );

      // 5. Notificar usuário (via WebSocket, email, etc)
      await this.notifyUser(
        data.userId,
        data.transcriptionId,
        'completed',
        transcriptionResult,
      );

      const processingTimeMs = Date.now() - startTime;

      this.logger.log(
        `Transcrição ${data.transcriptionId} processada com sucesso em ${processingTimeMs}ms`,
      );

      return {
        transcriptionId: data.transcriptionId,
        status: 'completed',
        transcriptText: transcriptionResult.text,
        segments: transcriptionResult.segments,
        confidence: transcriptionResult.confidence,
        processedAt: new Date(),
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      this.logger.error(
        `Erro ao processar transcrição ${data.transcriptionId}: ${error.message}`,
        error.stack,
      );

      // Atualizar status para "failed"
      await this.updateTranscriptionStatus(
        data.transcriptionId,
        'failed',
        null,
        error.message,
      );

      // Notificar usuário sobre falha
      await this.notifyUser(
        data.userId,
        data.transcriptionId,
        'failed',
        null,
        error.message,
      );

      return {
        transcriptionId: data.transcriptionId,
        status: 'failed',
        errorMessage: error.message,
        processedAt: new Date(),
        processingTimeMs,
      };
    }
  }

  /**
   * Baixa arquivo de áudio do Firebase Storage
   * Suporta URLs assinadas
   *
   * @param audioUrl - URL do arquivo de áudio
   * @returns Buffer com conteúdo do áudio
   */
  private async downloadAudioFile(audioUrl: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const url = new URL(audioUrl);
      const protocol = url.protocol === 'https:' ? https : require('http');

      const request = protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Erro ao baixar arquivo: HTTP ${response.statusCode}`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        response.on('error', (error) => {
          reject(error);
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      // Timeout de 5 minutos
      request.setTimeout(300000, () => {
        request.destroy();
        reject(new Error('Timeout ao baixar arquivo de áudio'));
      });
    });
  }

  /**
   * Atualiza status de uma transcrição em Firestore
   *
   * @param transcriptionId - ID da transcrição
   * @param status - Novo status (processing, completed, failed)
   * @param transcriptionResult - Resultado da transcrição (se concluída)
   * @param errorMessage - Mensagem de erro (se falhou)
   */
  private async updateTranscriptionStatus(
    transcriptionId: string,
    status: 'processing' | 'completed' | 'failed',
    transcriptionResult?: AsrTranscriptionResult,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'completed' && transcriptionResult) {
        updateData.transcriptText = transcriptionResult.text;
        updateData.segments = transcriptionResult.segments;
        updateData.confidence = transcriptionResult.confidence;
        updateData.completedAt = new Date();
        updateData.provider = transcriptionResult.provider;
      }

      if (status === 'failed' && errorMessage) {
        updateData.errorMessage = errorMessage;
        updateData.failedAt = new Date();
      }

      await this.firebaseAdapter.updateTranscription(
        transcriptionId,
        updateData,
      );

      this.logger.debug(
        `Status de transcrição ${transcriptionId} atualizado para ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Erro ao atualizar status de transcrição: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Notifica usuário sobre conclusão ou falha de transcrição
   * Pode ser via WebSocket, email, push notification, etc
   *
   * @param userId - ID do usuário
   * @param transcriptionId - ID da transcrição
   * @param status - Status (completed, failed)
   * @param transcriptionResult - Resultado (se concluída)
   * @param errorMessage - Mensagem de erro (se falhou)
   */
  private async notifyUser(
    userId: string,
    transcriptionId: string,
    status: 'completed' | 'failed',
    transcriptionResult?: AsrTranscriptionResult,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const notification = {
        userId,
        transcriptionId,
        type: status === 'completed' ? 'transcription_completed' : 'transcription_failed',
        title:
          status === 'completed'
            ? 'Transcrição Concluída'
            : 'Erro na Transcrição',
        message:
          status === 'completed'
            ? `Sua transcrição foi processada com sucesso. Confiança: ${(transcriptionResult?.confidence || 0) * 100}%`
            : `Erro ao processar transcrição: ${errorMessage}`,
        timestamp: new Date(),
        data: {
          transcriptionId,
          status,
          ...(status === 'completed' && {
            confidence: transcriptionResult?.confidence,
            textPreview: transcriptionResult?.text.substring(0, 100),
          }),
        },
      };

      // TODO: Implementar diferentes canais de notificação
      // 1. WebSocket (tempo real)
      // 2. Email (notificação assíncrona)
      // 3. Push notification (mobile)
      // 4. In-app notification (salvar em Firestore)

      // Por enquanto, apenas log
      this.logger.log(
        `Notificação enviada ao usuário ${userId}: ${notification.title}`,
      );

      // Salvar notificação em Firestore para histórico
      await this.firebaseAdapter.createNotification(notification);
    } catch (error) {
      this.logger.error(
        `Erro ao notificar usuário: ${error.message}`,
      );
      // Não rejeitar o job se falhar a notificação
      // A transcrição foi salva com sucesso
    }
  }

  /**
   * Obtém estatísticas do worker
   * Útil para monitoramento
   *
   * @returns Estatísticas de processamento
   */
  async getWorkerStats() {
    try {
      const queueStats = await this.queueAdapter.getQueueStats();

      return {
        queueStats,
        timestamp: new Date(),
        status: 'running',
      };
    } catch (error) {
      this.logger.error(
        `Erro ao obter estatísticas do worker: ${error.message}`,
      );
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Pausa o processamento de jobs
   */
  async pauseWorker(): Promise<void> {
    try {
      await this.queueAdapter.pauseQueue();
      this.logger.log('Worker pausado');
    } catch (error) {
      this.logger.error(`Erro ao pausar worker: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retoma o processamento de jobs
   */
  async resumeWorker(): Promise<void> {
    try {
      await this.queueAdapter.resumeQueue();
      this.logger.log('Worker retomado');
    } catch (error) {
      this.logger.error(`Erro ao retomar worker: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retira um job específico da fila
   * Útil para cancelar transcrições
   *
   * @param jobId - ID do job
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.queueAdapter.removeJob(jobId);
      this.logger.log(`Job ${jobId} cancelado`);
    } catch (error) {
      this.logger.error(`Erro ao cancelar job: ${error.message}`);
      throw error;
    }
  }
}
