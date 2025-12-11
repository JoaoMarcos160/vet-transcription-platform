import { Injectable } from '@nestjs/common';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';

@Injectable()
export class UsersService {
  constructor(private firebaseAdapter: FirebaseAdapter) {}

  async getUserById(id: string) {
    // TODO: Implement get user by ID
    return { id, message: 'User service stub' };
  }
}
