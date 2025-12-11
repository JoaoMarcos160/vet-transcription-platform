import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, QueueEvents } from 'bullmq';
import * as Redis from 'ioredis';

/**
 * Interface para job de transcrição
 */
export interface TranscriptionJob {
  transcriptionId: string;
  userId: string;
  audioUrl: string;
  audioFormat: 'mp3' | 'wav' | 'm4a' | 'opus' | 'ogg' | 'webm';
  durationSeconds: number;
  audioFileId: string;
}

/**
 * Interface para resultado de job processado
 */
export interface TranscriptionJobResult {
  transcriptionId: string;
  status: 'completed' | 'failed';
  transcriptText?: string;
  segments?: any[];
  confidence?: number;
  errorMessage?: string;
  processedAt: Date;
  processingTimeMs: number;
}

/**
 * Interface para estatísticas da fila
 */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Adapter para gerenciar filas de jobs usando BullMQ e Redis
 * Responsável por enfileirar jobs de transcrição e processar resultados
 */
@Injectable()
export class QueueAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueAdapter.name);
  private redisClient: Redis.Redis;
  private transcriptionQueue: Queue<TranscriptionJob>;
  private queueEvents: QueueEvents;
  private worker: Worker<TranscriptionJob>;

  constructor(private configService: ConfigService) {}

  /**
   * Inicializa conexão com Redis e cria fila
   * Chamado automaticamente pelo NestJS
   */
  async onModuleInit(): Promise<void> {
    try {
      const redisHost = this.configService.get('REDIS_HOST', 'localhost');
      const redisPort = parseInt(
        this.configService.get('REDIS_PORT', '6379'),
        10,
      );
      const redisPassword = this.configService.get('REDIS_PASSWORD');

      // Configurar cliente Redis
      this.redisClient = new Redis.default({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        },
      });

      this.logger.log(
        `Conectado ao Redis em ${redisHost}:${redisPort}`,
      );

      // Criar fila de transcrição
      this.transcriptionQueue = new Queue<TranscriptionJob>(
        'transcriptions',
        {
          connection: this.redisClient,
          defaultJobOptions: {
            attempts: 3, // Tentar 3 vezes em caso de falha
            backoff: {
              type: 'exponential',
              delay: 2000, // 2 segundos de delay inicial
            },
            removeOnComplete: {
              age: 3600, // Manter jobs completados por 1 hora
            },
            removeOnFail: {
              age: 86400, // Manter jobs falhados por 24 horas
            },
          },
        },
      );

      // Configurar event listener para fila
      this.queueEvents = new QueueEvents('transcriptions', {
        connection: this.redisClient,
      });

      // Listeners de eventos da fila
      this.queueEvents.on('completed', ({ jobId }) => {
        this.logger.log(`Job ${jobId} completado com sucesso`);
      });

      this.queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.logger.error(
          `Job ${jobId} falhou: ${failedReason}`,
        );
      });

      this.queueEvents.on('error', (err) => {
        this.logger.error(`Erro na fila: ${err.message}`);
      });

      this.logger.log('Fila de transcrição inicializada com sucesso');
    } catch (error) {
      this.logger.error(
        `Erro ao inicializar QueueAdapter: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Limpa recursos ao desligar o módulo
   */
  async onModuleDestroy(): Promise<void> {
    try {
      if (this.queueEvents) {
        await this.queueEvents.close();
      }
      if (this.transcriptionQueue) {
        await this.transcriptionQueue.close();
      }
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      this.logger.log('QueueAdapter finalizado');
    } catch (error) {
      this.logger.error(
        `Erro ao finalizar QueueAdapter: ${error.message}`,
      );
    }
  }

  /**
   * Enfileira um job de transcrição
   * Retorna imediatamente, processamento acontece em background
   *
   * @param job - Job de transcrição a enfileirar
   * @returns ID do job enfileirado
   */
  async enqueueTranscriptionJob(job: TranscriptionJob): Promise<string> {
    try {
      const enqueuedJob = await this.transcriptionQueue.add(
        `transcription-${job.transcriptionId}`,
        job,
        {
          priority: this.calculatePriority(job.durationSeconds),
          delay: 0, // Processar imediatamente
        },
      );

      this.logger.log(
        `Job de transcrição enfileirado: ${enqueuedJob.id} (Transcrição: ${job.transcriptionId})`,
      );

      return enqueuedJob.id;
    } catch (error) {
      this.logger.error(
        `Erro ao enfileirar job de transcrição: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Enfileira múltiplos jobs de transcrição
   *
   * @param jobs - Array de jobs a enfileirar
   * @returns Array de IDs dos jobs enfileirados
   */
  async enqueueMultipleTranscriptionJobs(
    jobs: TranscriptionJob[],
  ): Promise<string[]> {
    try {
      const enqueuedJobs = await this.transcriptionQueue.addBulk(
        jobs.map((job) => ({
          name: `transcription-${job.transcriptionId}`,
          data: job,
          opts: {
            priority: this.calculatePriority(job.durationSeconds),
          },
        })),
      );

      this.logger.log(
        `${enqueuedJobs.length} jobs de transcrição enfileirados`,
      );

      return enqueuedJobs.map((j) => j.id);
    } catch (error) {
      this.logger.error(
        `Erro ao enfileirar múltiplos jobs: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Obtém status de um job
   *
   * @param jobId - ID do job
   * @returns Informações do job (status, progresso, etc)
   */
  async getJobStatus(jobId: string) {
    try {
      const job = await this.transcriptionQueue.getJob(jobId);

      if (!job) {
        return null;
      }

      const state = await job.getState();
      const progress = job.progress();
      const attempts = job.attemptsMade;
      const maxAttempts = job.opts.attempts;

      return {
        id: job.id,
        name: job.name,
        state,
        progress,
        attempts,
        maxAttempts,
        data: job.data,
        result: job.returnvalue,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      };
    } catch (error) {
      this.logger.error(`Erro ao obter status do job: ${error.message}`);
      return null;
    }
  }

  /**
   * Obtém estatísticas da fila de transcrição
   *
   * @returns QueueStats com contagem de jobs por estado
   */
  async getQueueStats(): Promise<QueueStats> {
    try {
      const counts = await this.transcriptionQueue.getJobCounts(
        'wait',
        'active',
        'completed',
        'failed',
        'delayed',
      );

      return {
        waiting: counts.wait || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao obter estatísticas da fila: ${error.message}`,
      );
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      };
    }
  }

  /**
   * Pausa a fila (não processa novos jobs)
   */
  async pauseQueue(): Promise<void> {
    try {
      await this.transcriptionQueue.pause();
      this.logger.log('Fila de transcrição pausada');
    } catch (error) {
      this.logger.error(`Erro ao pausar fila: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retoma a fila (volta a processar jobs)
   */
  async resumeQueue(): Promise<void> {
    try {
      await this.transcriptionQueue.resume();
      this.logger.log('Fila de transcrição retomada');
    } catch (error) {
      this.logger.error(`Erro ao retomar fila: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove um job da fila
   * Útil para cancelar transcrições
   *
   * @param jobId - ID do job a remover
   */
  async removeJob(jobId: string): Promise<void> {
    try {
      const job = await this.transcriptionQueue.getJob(jobId);

      if (job) {
        await job.remove();
        this.logger.log(`Job ${jobId} removido da fila`);
      }
    } catch (error) {
      this.logger.error(`Erro ao remover job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Limpa todos os jobs completados da fila
   * Útil para limpeza periódica
   *
   * @returns Número de jobs removidos
   */
  async cleanCompletedJobs(): Promise<number> {
    try {
      const removed = await this.transcriptionQueue.clean(3600, 1000, 'completed');
      this.logger.log(`${removed.length} jobs completados removidos`);
      return removed.length;
    } catch (error) {
      this.logger.error(`Erro ao limpar jobs: ${error.message}`);
      return 0;
    }
  }

  /**
   * Registra um listener para processar jobs de transcrição
   * Deve ser chamado pelo TranscriptionWorker
   *
   * @param processor - Função que processa o job
   */
  registerTranscriptionProcessor(
    processor: (job: any) => Promise<TranscriptionJobResult>,
  ): void {
    try {
      this.worker = new Worker<TranscriptionJob>(
        'transcriptions',
        processor,
        {
          connection: this.redisClient,
          concurrency: parseInt(
            this.configService.get('WORKER_CONCURRENCY', '5'),
            10,
          ), // Processar até 5 jobs em paralelo
          settings: {
            lockDuration: 30000, // Lock de 30 segundos
            lockRenewTime: 15000, // Renovar lock a cada 15 segundos
            maxStalledCount: 2, // Máximo de vezes que pode ficar travado
            stalledInterval: 5000, // Verificar jobs travados a cada 5 segundos
            retryProcessDelay: 5000, // Delay de 5 segundos antes de retry
          },
        },
      );

      this.worker.on('completed', (job) => {
        this.logger.log(
          `Job ${job.id} processado com sucesso (${job.data.transcriptionId})`,
        );
      });

      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `Job ${job.id} falhou: ${err.message} (${job.data.transcriptionId})`,
        );
      });

      this.logger.log('Processor de transcrição registrado');
    } catch (error) {
      this.logger.error(
        `Erro ao registrar processor: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Calcula prioridade do job baseado na duração
   * Jobs mais curtos têm prioridade mais alta
   *
   * @param durationSeconds - Duração em segundos
   * @returns Número de prioridade (0 = mais alta)
   */
  private calculatePriority(durationSeconds: number): number {
    // Prioridade baseada em duração
    // 0-300s (5 min): prioridade 1
    // 300-900s (15 min): prioridade 2
    // 900-1800s (30 min): prioridade 3
    // 1800s+ (30+ min): prioridade 4

    if (durationSeconds <= 300) {
      return 1;
    } else if (durationSeconds <= 900) {
      return 2;
    } else if (durationSeconds <= 1800) {
      return 3;
    } else {
      return 4;
    }
  }

  /**
   * Obtém a instância da fila (para acesso direto se necessário)
   */
  getQueue(): Queue<TranscriptionJob> {
    return this.transcriptionQueue;
  }

  /**
   * Obtém a instância do Redis client
   */
  getRedisClient(): Redis.Redis {
    return this.redisClient;
  }
}
