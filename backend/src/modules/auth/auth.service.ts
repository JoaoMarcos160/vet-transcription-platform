import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';
import * as admin from 'firebase-admin';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private firebaseAdapter: FirebaseAdapter,
  ) {}

  async validateGoogleToken(token: string) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      const uid = decodedToken.uid;
      const email = decodedToken.email;

      let user = await this.firebaseAdapter.getUserByEmail(email);
      if (!user) {
        user = await this.firebaseAdapter.createUser({
          id: uid,
          email,
          name: decodedToken.name || '',
          googleId: decodedToken.sub,
          tier: 'free',
          storageQuota: 5 * 1024 * 1024 * 1024,
          storageUsed: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const jwt = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: '7d' },
      );

      return {
        user,
        jwt,
        message: 'Successfully authenticated',
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid Google token');
    }
  }
}
