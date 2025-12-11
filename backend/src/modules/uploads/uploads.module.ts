import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, FirebaseAdapter],
})
export class UploadsModule {}
