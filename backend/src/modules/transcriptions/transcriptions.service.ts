import { Injectable } from '@nestjs/common';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';

@Injectable()
export class TranscriptionsService {
  constructor(private firebaseAdapter: FirebaseAdapter) {}

  async getTranscription(id: string) {
    // TODO: Implement get transcription logic
    return { id, message: 'Transcription service stub' };
  }

  async createCheckoutSession(transcriptionId: string, userId: string) {
    // TODO: Implement Stripe checkout session creation
    return { message: 'Checkout session stub' };
  }
}
