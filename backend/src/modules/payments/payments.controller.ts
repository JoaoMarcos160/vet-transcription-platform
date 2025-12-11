import { Controller, Post, Body } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('webhooks/stripe')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post()
  async handleStripeWebhook(@Body() body: any) {
    return this.paymentsService.handleWebhook(body);
  }
}
