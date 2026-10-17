import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BlockchainAnchorResult {
  txId: string;
  hash: string;
  network: string;
  timestamp: string;
  blockHeight: number | null;
  metadata: Record<string, unknown>;
}

export interface TransactionDetails {
  txId: string;
  confirmations: number;
  blockHeight: number;
  timestamp: string;
}

/**
 * Ported near-verbatim from `backend/src/services/bitcoinService.js`
 * (class `BitcoinService`) — same method names, same behavior, same
 * SIMULATED anchoring. Do not "fix" `anchorDocumentHash` into a real chain
 * call; that was never real in the old app either (see the method's own
 * comment, and the plan's explicit instruction to port this as-is).
 */
@Injectable()
export class CertificateAnchorService {
  private readonly logger = new Logger(CertificateAnchorService.name);
  private readonly network: string;
  private readonly rpcUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.network = this.configService.get<string>('bitcoin.network', 'testnet');
    this.rpcUrl = this.configService.get<string>('bitcoin.rpcUrl', '');
  }

  /** Create a hash of the document for anchoring. Ported verbatim from `bitcoinService.createDocumentHash`. */
  createDocumentHash(documentData: Record<string, unknown>): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(documentData));
    return hash.digest('hex');
  }

  /**
   * Simulate anchoring document hash to Bitcoin testnet.
   *
   * SIMULATED — no real Bitcoin testnet broadcast, ported as-is from
   * backend/src/services/bitcoinService.js. In a real implementation this
   * would create an OP_RETURN transaction and broadcast it; here it just
   * generates a random fake transaction id. Do not replace this with a real
   * chain call as part of this round.
   */
  async anchorDocumentHash(
    documentHash: string,
    metadata: Record<string, unknown> = {},
  ): Promise<BlockchainAnchorResult> {
    try {
      // For demo purposes, we'll just log the anchoring.
      // In production, you would:
      // 1. Create a Bitcoin transaction with OP_RETURN containing the hash
      // 2. Broadcast it to the testnet
      // 3. Wait for confirmation
      // 4. Return the transaction ID
      this.logger.log(`[CALL] Anchoring document hash to Bitcoin ${this.network}: ${documentHash}`);

      // Simulate a transaction ID for demo purposes.
      const simulatedTxId = crypto.randomBytes(32).toString('hex');

      return {
        txId: simulatedTxId,
        hash: documentHash,
        network: this.network,
        timestamp: new Date().toISOString(),
        blockHeight: null, // Would be set after confirmation
        metadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[RESULT] Error anchoring document: ${message}`);
      throw new Error('Failed to anchor document to blockchain');
    }
  }

  /** Verify a document against its blockchain anchor. Ported verbatim (still simulated) from `bitcoinService.verifyDocumentHash`. */
  async verifyDocumentHash(documentHash: string, txId: string): Promise<{
    verified: boolean;
    txId: string;
    hash: string;
    network: string;
    timestamp: string;
  }> {
    try {
      // In production, this would:
      // 1. Query the Bitcoin blockchain for the transaction
      // 2. Extract the OP_RETURN data
      // 3. Verify it matches the document hash
      this.logger.log(`[CALL] Verifying document hash ${documentHash} against tx ${txId}`);

      // For demo, we'll simulate verification.
      return {
        verified: true,
        txId,
        hash: documentHash,
        network: this.network,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[RESULT] Error verifying document: ${message}`);
      throw new Error('Failed to verify document on blockchain');
    }
  }

  /** Get transaction details from blockchain. Ported verbatim (still mock data) from `bitcoinService.getTransaction`. */
  async getTransaction(txId: string): Promise<TransactionDetails> {
    try {
      // In production, query the blockchain API. For demo purposes, return mock data.
      return {
        txId,
        confirmations: 6,
        blockHeight: 2500000,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[RESULT] Error getting transaction: ${message}`);
      throw new Error('Failed to get transaction details');
    }
  }
}
