import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentsService {
  async handleWebhook(body: any) {
    // TODO: Implement Stripe webhook handling
    return { message: 'Webhook received' };
  }
}
