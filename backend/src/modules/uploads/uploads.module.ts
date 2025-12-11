import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';
import { QueueAdapter } from '../../infrastructure/adapters/queue/queue.adapter';

/**
 * Módulo de uploads
 * Gerencia upload de arquivos de áudio para Firebase Storage
 * Enfileira jobs de transcrição para processamento assíncrono
 */
@Module({
  imports: [ConfigModule],
  controllers: [UploadsController],
  providers: [UploadsService, FirebaseAdapter, QueueAdapter],
  exports: [UploadsService],
})
export class UploadsModule {}
