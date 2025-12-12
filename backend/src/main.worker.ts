import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionWorkerModule } from './workers/transcription.worker.module';
import { TranscriptionWorker } from './workers/transcription.worker';

/**
 * Entry point para executar o Transcription Worker como processo separado
 * Útil para:
 * - Escalar workers independentemente da API
 * - Executar em máquinas diferentes
 * - Processar jobs de forma isolada
 *
 * Executar com: npm run start:worker
 */
async function bootstrap() {
  const logger = new Logger('TranscriptionWorkerBootstrap');

  try {
    logger.log('Iniciando Transcription Worker...');

    // Criar aplicação NestJS
    const app = await NestFactory.create(TranscriptionWorkerModule, {
      logger: ['log', 'error', 'warn', 'debug'],
    });

    const configService = app.get(ConfigService);
    const worker = app.get(TranscriptionWorker);

    // Configurações
    const redisHost = configService.get('REDIS_HOST', 'localhost');
    const redisPort = configService.get('REDIS_PORT', '6379');
    const workerConcurrency = configService.get('WORKER_CONCURRENCY', '5');
    const asrProvider = configService.get('ASR_PROVIDER', 'google-cloud-speech');

    logger.log(`Redis: ${redisHost}:${redisPort}`);
    logger.log(`Concorrência: ${workerConcurrency} jobs simultâneos`);
    logger.log(`Provedor ASR: ${asrProvider}`);

    // Inicializar worker (já feito no constructor, mas pode adicionar lógica aqui)
    logger.log('✅ Transcription Worker iniciado com sucesso');
    logger.log('Aguardando jobs na fila...');

    // Manter processo rodando
    await app.listen(3002); // Porta diferente da API

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.log('SIGTERM recebido, encerrando worker...');
      await app.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.log('SIGINT recebido, encerrando worker...');
      await app.close();
      process.exit(0);
    });
  } catch (error) {
    const logger = new Logger('TranscriptionWorkerBootstrap');
    logger.error(`Erro ao iniciar worker: ${error.message}`, error.stack);
    process.exit(1);
  }
}

bootstrap();
