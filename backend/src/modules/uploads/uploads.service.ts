import { Injectable } from '@nestjs/common';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';

@Injectable()
export class UploadsService {
  constructor(private firebaseAdapter: FirebaseAdapter) {}

  async uploadAudio(userId: string, file: Express.Multer.File) {
    // TODO: Implement audio upload logic
    return {
      message: 'Upload service stub',
      userId,
      fileName: file?.originalname,
    };
  }
}
