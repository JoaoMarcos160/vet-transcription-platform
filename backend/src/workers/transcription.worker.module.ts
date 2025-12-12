import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TranscriptionWorker } from './transcription.worker';
import { FirebaseAdapter } from '../infrastructure/adapters/firebase/firebase.adapter';
import { AsrAdapter } from '../infrastructure/adapters/asr/asr.adapter';
import { QueueAdapter } from '../infrastructure/adapters/queue/queue.adapter';

/**
 * Módulo do Transcription Worker
 * Gerencia processamento de jobs de transcrição
 * Pode ser executado como serviço separado ou integrado ao app principal
 */
@Module({
  imports: [ConfigModule],
  providers: [
    TranscriptionWorker,
    FirebaseAdapter,
    AsrAdapter,
    QueueAdapter,
  ],
  exports: [TranscriptionWorker],
})
export class TranscriptionWorkerModule {}
