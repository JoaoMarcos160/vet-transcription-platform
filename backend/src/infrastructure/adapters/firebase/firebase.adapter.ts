import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class FirebaseAdapter {
  private db: admin.firestore.Firestore;
  private storage: Storage;

  constructor() {
    // Initialize Firebase Admin SDK
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
    }

    this.db = admin.firestore();
    this.storage = new Storage({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  // User operations
  async getUserByEmail(email: string) {
    const snapshot = await this.db
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data();
  }

  async createUser(user: any) {
    const docRef = this.db.collection('users').doc(user.id);
    await docRef.set(user);
    return { ...user, id: docRef.id };
  }

  // Transcription operations
  async createTranscription(transcription: any) {
    const docRef = this.db.collection('transcriptions').doc();
    await docRef.set({ ...transcription, id: docRef.id });
    return { ...transcription, id: docRef.id };
  }

  async getTranscription(id: string) {
    const doc = await this.db.collection('transcriptions').doc(id).get();
    return doc.exists ? doc.data() : null;
  }

  async updateTranscription(id: string, updates: any) {
    await this.db.collection('transcriptions').doc(id).update(updates);
  }

  // Payment operations
  async createPayment(payment: any) {
    const docRef = this.db.collection('payments').doc();
    await docRef.set({ ...payment, id: docRef.id });
    return { ...payment, id: docRef.id };
  }

  // Storage operations
  async uploadFile(
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const bucket = this.storage.bucket(process.env.FIREBASE_STORAGE_BUCKET!);
    const file = bucket.file(path);
    await file.save(buffer, { metadata: { contentType } });
    return `gs://${bucket.name}/${path}`;
  }

  async getSignedUrl(path: string, expiresIn: number = 3600): Promise<string> {
    const bucket = this.storage.bucket(process.env.FIREBASE_STORAGE_BUCKET!);
    const file = bucket.file(path);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    });
    return url;
  }
}
