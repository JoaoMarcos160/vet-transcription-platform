import { Module } from '@nestjs/common';
import { TranscriptionsController } from './transcriptions.controller';
import { TranscriptionsService } from './transcriptions.service';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';

@Module({
  controllers: [TranscriptionsController],
  providers: [TranscriptionsService, FirebaseAdapter],
})
export class TranscriptionsModule {}
