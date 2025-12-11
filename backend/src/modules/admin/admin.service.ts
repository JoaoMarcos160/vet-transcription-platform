import { Injectable } from '@nestjs/common';

@Injectable()
export class AdminService {
  async getStats() {
    // TODO: Implement admin stats
    return { message: 'Admin stats stub' };
  }
}
