import { Request, Response } from 'express';
import { TonService } from '../services/ton.service';
import { ErrorCodes, HttpCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';

export class TonController {
  private tonService: TonService;

  constructor() {
    this.tonService = TonService.getInstance();
  }

  /**
   * Create a new TON payment invoice
   * POST /api/ton/invoice
   * Body: { userId: number, amount: number, expirationMinutes?: number }
   */
  public createInvoice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId, amount, expirationMinutes } = req.body;

      if (!userId || !amount) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'userId and amount are required',
        );
      }

      const paymentDetails = await this.tonService.createInvoice({
        userId: parseInt(userId),
        amount: parseFloat(amount),
        expirationMinutes: expirationMinutes
          ? parseInt(expirationMinutes)
          : undefined,
      });

      res.status(HttpCodes.Created).json({
        success: true,
        data: paymentDetails,
        message: 'Invoice created successfully',
      });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('[TON Controller] Error creating invoice:', error);
        res.status(HttpCodes.InternalServerError).json({
          success: false,
          error: 'Failed to create invoice',
        });
      }
    }
  };

  /**
   * Get invoice status
   * GET /api/ton/invoice/:invoiceId
   */
  public getInvoiceStatus = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const { invoiceId } = req.params;

      if (!invoiceId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Invoice ID is required',
        );
      }

      const invoice = await this.tonService.getInvoiceStatus(invoiceId);

      if (!invoice) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Invoice not found',
        );
      }

      res.status(HttpCodes.Ok).json({
        success: true,
        data: invoice,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('[TON Controller] Error getting invoice status:', error);
        res.status(HttpCodes.InternalServerError).json({
          success: false,
          error: 'Failed to get invoice status',
        });
      }
    }
  };

  /**
   * Get all pending invoices for a user
   * GET /api/ton/invoices/user/:userId
   */
  public getUserInvoices = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const { userId } = req.params;

      if (!userId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'User ID is required',
        );
      }

      const invoices = await this.tonService.getUserPendingInvoices(parseInt(userId));

      res.status(HttpCodes.Ok).json({
        success: true,
        data: invoices,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('[TON Controller] Error getting user invoices:', error);
        res.status(HttpCodes.InternalServerError).json({
          success: false,
          error: 'Failed to get user invoices',
        });
      }
    }
  };

  /**
   * Cancel an invoice
   * DELETE /api/ton/invoice/:invoiceId
   */
  public cancelInvoice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { invoiceId } = req.params;

      if (!invoiceId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Invoice ID is required',
        );
      }

      const cancelled = await this.tonService.cancelInvoice(invoiceId);

      if (!cancelled) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Invoice not found or cannot be cancelled',
        );
      }

      res.status(HttpCodes.Ok).json({
        success: true,
        message: 'Invoice cancelled successfully',
      });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('[TON Controller] Error cancelling invoice:', error);
        res.status(HttpCodes.InternalServerError).json({
          success: false,
          error: 'Failed to cancel invoice',
        });
      }
    }
  };

  /**
   * Get wallet information
   * GET /api/ton/wallet
   */
  public getWalletInfo = async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const walletAddress = this.tonService.getWalletAddress();
      const network = this.tonService.getNetwork();

      res.status(HttpCodes.Ok).json({
        success: true,
        data: {
          walletAddress,
          network,
        },
      });
    } catch (error) {
      console.error('[TON Controller] Error getting wallet info:', error);
      res.status(HttpCodes.InternalServerError).json({
        success: false,
        error: 'Failed to get wallet information',
      });
    }
  };

  /**
   * Manually process incoming transactions (admin only)
   * POST /api/ton/process-transactions
   */
  public processTransactions = async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const processedPayments =
        await this.tonService.processIncomingTransactions();

      res.status(HttpCodes.Ok).json({
        success: true,
        data: {
          processedCount: processedPayments.length,
          payments: processedPayments,
        },
        message: `Processed ${processedPayments.length} payments`,
      });
    } catch (error) {
      console.error('[TON Controller] Error processing transactions:', error);
      res.status(HttpCodes.InternalServerError).json({
        success: false,
        error: 'Failed to process transactions',
      });
    }
  };

  /**
   * Manually verify and process a specific transaction
   * POST /api/ton/verify-transaction
   * Body: { transactionHash: string, invoiceId: string }
   */
  public verifyTransaction = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const { transactionHash, invoiceId } = req.body;

      if (!transactionHash || !invoiceId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'transactionHash and invoiceId are required',
        );
      }

      const result = await this.tonService.verifyAndProcessTransaction(
        transactionHash,
        invoiceId,
      );

      if (result.success) {
        res.status(HttpCodes.Ok).json({
          success: true,
          data: result,
          message: 'Transaction verified and processed',
        });
      } else {
        res.status(HttpCodes.BadRequest).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('[TON Controller] Error verifying transaction:', error);
        res.status(HttpCodes.InternalServerError).json({
          success: false,
          error: 'Failed to verify transaction',
        });
      }
    }
  };

  public encodePayload = async (req: Request, res: Response): Promise<void> => {
    const { text } = req.body;
    if (typeof text !== 'string') {
      throw HttpException.BadRequest(ErrorCodes.BadRequest, 'text is required');
    }
    const { beginCell } = await import('@ton/core');
    const cell = beginCell().storeUint(0, 32).storeStringTail(text).endCell();
    res.status(HttpCodes.Ok).json({ success: true, data: { payload: cell.toBoc().toString('base64') } });
  };
}
