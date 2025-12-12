import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as speech from '@google-cloud/speech';

/**
 * Interface para opções de transcrição
 */
export interface TranscriptionOptions {
  languageCode: string; // ex: 'pt-BR', 'en-US'
  enableAutomaticPunctuation?: boolean;
  enableWordTimeOffsets?: boolean;
  enableSpeakerDiarization?: boolean;
  maxAlternatives?: number;
  sampleRateHertz?: number;
  audioChannelCount?: number;
}

/**
 * Interface para segmento de transcrição
 */
export interface TranscriptSegment {
  startTime: number; // segundos
  endTime: number; // segundos
  text: string;
  confidence: number; // 0-1
  speaker?: string; // Identificação de falante (se diarização habilitada)
}

/**
 * Interface para resultado de transcrição
 */
export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  confidence: number; // Confiança média
  duration: number; // Duração em segundos
  language: string;
  provider: string;
}

/**
 * Adapter para provedores de Speech-to-Text (ASR)
 * Abstrai diferentes provedores (Google Cloud Speech, Azure Speech, etc)
 * Permite trocar de provedor sem alterar código do worker
 */
@Injectable()
export class AsrAdapter {
  private readonly logger = new Logger(AsrAdapter.name);
  private googleSpeechClient: speech.SpeechClient;
  private provider: string;

  constructor(private configService: ConfigService) {
    this.provider = this.configService.get('ASR_PROVIDER', 'google-cloud-speech');
    this.initializeProvider();
  }

  /**
   * Inicializa o cliente do provedor de ASR
   */
  private initializeProvider(): void {
    try {
      switch (this.provider) {
        case 'google-cloud-speech':
          this.initializeGoogleCloudSpeech();
          break;
        case 'azure-speech':
          // TODO: Implementar Azure Speech
          this.logger.warn('Azure Speech não implementado ainda');
          break;
        default:
          throw new Error(`Provedor ASR desconhecido: ${this.provider}`);
      }
      this.logger.log(`ASR Adapter inicializado com provedor: ${this.provider}`);
    } catch (error) {
      this.logger.error(
        `Erro ao inicializar ASR Adapter: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Inicializa cliente Google Cloud Speech-to-Text
   */
  private initializeGoogleCloudSpeech(): void {
    try {
      // Usar credenciais do arquivo JSON ou variáveis de ambiente
      const credentials = this.configService.get('GOOGLE_CLOUD_CREDENTIALS');

      if (credentials) {
        const credentialsObj = JSON.parse(credentials);
        this.googleSpeechClient = new speech.SpeechClient({
          credentials: credentialsObj,
        });
      } else {
        // Usar credenciais padrão (Application Default Credentials)
        this.googleSpeechClient = new speech.SpeechClient();
      }

      this.logger.log('Google Cloud Speech-to-Text client inicializado');
    } catch (error) {
      this.logger.error(
        `Erro ao inicializar Google Cloud Speech: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Transcreve arquivo de áudio
   * Detecta automaticamente o formato baseado na extensão
   *
   * @param audioBuffer - Buffer com conteúdo do áudio
   * @param audioFormat - Formato do áudio (mp3, wav, m4a, opus, ogg, webm)
   * @param options - Opções de transcrição
   * @returns Resultado da transcrição
   */
  async transcribe(
    audioBuffer: Buffer,
    audioFormat: 'mp3' | 'wav' | 'm4a' | 'opus' | 'ogg' | 'webm',
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    try {
      this.logger.log(
        `Iniciando transcrição com ${this.provider} (formato: ${audioFormat})`,
      );

      switch (this.provider) {
        case 'google-cloud-speech':
          return await this.transcribeWithGoogleCloudSpeech(
            audioBuffer,
            audioFormat,
            options,
          );
        case 'azure-speech':
          // TODO: Implementar Azure Speech
          throw new Error('Azure Speech não implementado');
        default:
          throw new Error(`Provedor desconhecido: ${this.provider}`);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao transcrever áudio: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Transcreve usando Google Cloud Speech-to-Text
   *
   * @param audioBuffer - Buffer com conteúdo do áudio
   * @param audioFormat - Formato do áudio
   * @param options - Opções de transcrição
   * @returns Resultado da transcrição
   */
  private async transcribeWithGoogleCloudSpeech(
    audioBuffer: Buffer,
    audioFormat: 'mp3' | 'wav' | 'm4a' | 'opus' | 'ogg' | 'webm',
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    try {
      // Mapear formato de áudio para encoding do Google Cloud
      const encodingMap: Record<string, any> = {
        mp3: 'MP3',
        wav: 'LINEAR16',
        m4a: 'MP4',
        opus: 'OGG_OPUS',
        ogg: 'OGG_OPUS',
        webm: 'WEBM_OPUS',
      };

      const encoding = encodingMap[audioFormat];
      if (!encoding) {
        throw new Error(`Formato de áudio não suportado: ${audioFormat}`);
      }

      // Preparar request para Google Cloud Speech
      const request = {
        audio: {
          content: audioBuffer.toString('base64'),
        },
        config: {
          encoding: encoding,
          languageCode: options.languageCode,
          enableAutomaticPunctuation: options.enableAutomaticPunctuation ?? true,
          enableWordTimeOffsets: options.enableWordTimeOffsets ?? true,
          enableSpeakerDiarization: options.enableSpeakerDiarization ?? false,
          diarizationSpeakerCount: options.enableSpeakerDiarization ? 2 : undefined,
          maxAlternatives: options.maxAlternatives ?? 1,
          sampleRateHertz: options.sampleRateHertz,
          audioChannelCount: options.audioChannelCount,
          // Usar modelo melhorado para português
          useEnhanced: true,
          model: 'latest_long',
        },
      };

      this.logger.debug('Chamando Google Cloud Speech API...');

      // Chamar API do Google Cloud
      const [response] = await this.googleSpeechClient.recognize(request);

      // Processar resposta
      const results = response.results || [];

      if (results.length === 0) {
        this.logger.warn('Nenhum resultado de transcrição retornado');
        return {
          text: '',
          segments: [],
          confidence: 0,
          duration: 0,
          language: options.languageCode,
          provider: this.provider,
        };
      }

      // Extrair texto completo
      const fullText = results
        .map((result) =>
          result.alternatives?.[0]?.transcript || '',
        )
        .join(' ')
        .trim();

      // Extrair segmentos com timestamps
      const segments = this.extractSegments(results);

      // Calcular confiança média
      const confidences = results
        .flatMap((result) => result.alternatives || [])
        .map((alt) => alt.confidence || 0);

      const averageConfidence =
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0;

      // Estimar duração (aproximação)
      const lastSegment = segments[segments.length - 1];
      const duration = lastSegment ? lastSegment.endTime : 0;

      this.logger.log(
        `Transcrição concluída: ${fullText.length} caracteres, confiança: ${(averageConfidence * 100).toFixed(2)}%`,
      );

      return {
        text: fullText,
        segments,
        confidence: averageConfidence,
        duration,
        language: options.languageCode,
        provider: this.provider,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao transcrever com Google Cloud Speech: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Extrai segmentos de transcrição com timestamps
   * Processa a resposta do Google Cloud Speech
   *
   * @param results - Resultados do Google Cloud Speech
   * @returns Array de segmentos
   */
  private extractSegments(results: any[]): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];

    results.forEach((result, resultIndex) => {
      const alternative = result.alternatives?.[0];
      if (!alternative) return;

      const words = alternative.words || [];
      let currentSegment: Partial<TranscriptSegment> = {
        text: '',
        startTime: 0,
        confidence: alternative.confidence || 0,
      };

      words.forEach((word, wordIndex) => {
        const wordText = word.word || '';
        const startTime = this.parseTime(word.startTime);
        const endTime = this.parseTime(word.endTime);

        // Inicializar segmento
        if (currentSegment.text === '') {
          currentSegment.startTime = startTime;
        }

        // Adicionar palavra ao segmento
        currentSegment.text += (currentSegment.text ? ' ' : '') + wordText;
        currentSegment.endTime = endTime;

        // Quebrar segmento a cada 10 palavras ou fim do resultado
        const isLastWord = wordIndex === words.length - 1;
        const wordCount = (currentSegment.text?.split(' ') || []).length;

        if (wordCount >= 10 || isLastWord) {
          if (currentSegment.text) {
            segments.push({
              text: currentSegment.text,
              startTime: currentSegment.startTime || 0,
              endTime: currentSegment.endTime || 0,
              confidence: currentSegment.confidence || 0,
            });
          }
          currentSegment = {
            text: '',
            confidence: alternative.confidence || 0,
          };
        }
      });

      // Adicionar segmento final se houver
      if (currentSegment.text) {
        segments.push({
          text: currentSegment.text,
          startTime: currentSegment.startTime || 0,
          endTime: currentSegment.endTime || 0,
          confidence: currentSegment.confidence || 0,
        });
      }
    });

    return segments;
  }

  /**
   * Converte string de tempo (ex: "1.5s") para segundos
   *
   * @param timeStr - String de tempo
   * @returns Tempo em segundos
   */
  private parseTime(timeStr: any): number {
    if (!timeStr) return 0;

    if (typeof timeStr === 'number') return timeStr;

    if (typeof timeStr === 'object' && timeStr.seconds) {
      return timeStr.seconds + (timeStr.nanos || 0) / 1000000000;
    }

    if (typeof timeStr === 'string') {
      const match = timeStr.match(/(\d+(?:\.\d+)?)/);
      return match ? parseFloat(match[1]) : 0;
    }

    return 0;
  }

  /**
   * Obtém lista de idiomas suportados
   *
   * @returns Array de códigos de idioma
   */
  getSupportedLanguages(): string[] {
    // Idiomas mais comuns suportados pelo Google Cloud Speech
    return [
      'pt-BR', // Português (Brasil)
      'pt-PT', // Português (Portugal)
      'en-US', // Inglês (EUA)
      'en-GB', // Inglês (Reino Unido)
      'es-ES', // Espanhol (Espanha)
      'es-MX', // Espanhol (México)
      'fr-FR', // Francês
      'de-DE', // Alemão
      'it-IT', // Italiano
      'ja-JP', // Japonês
      'zh-CN', // Chinês (Simplificado)
      'zh-TW', // Chinês (Tradicional)
      'ko-KR', // Coreano
      'ru-RU', // Russo
    ];
  }

  /**
   * Obtém informações do provedor ASR
   *
   * @returns Informações do provedor
   */
  getProviderInfo() {
    return {
      provider: this.provider,
      supportedFormats: ['mp3', 'wav', 'm4a', 'opus', 'ogg', 'webm'],
      supportedLanguages: this.getSupportedLanguages(),
      features: {
        automaticPunctuation: true,
        wordTimeOffsets: true,
        speakerDiarization: true,
        multipleAlternatives: true,
      },
    };
  }
}
