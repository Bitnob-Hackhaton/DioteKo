import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { getCertificateTitle } from '../admin-certificates.constants';

export interface CertificateBlockchainAnchorDisplay {
  txId: string;
  network: string;
  timestamp: string;
}

export interface GeneratePdfParams {
  certificateType: string;
  /** Certificate content fields — same shape as the old `certificateData` object (`fullName`, `dateOfBirth`, ...), rendered conditionally (only present fields are printed). */
  holderData: Record<string, unknown>;
  /** Stable public id for this certificate (`AdminCertificateRef.externalReference`) — printed and used to build the default QR filename. */
  externalReference: string;
  /** String encoded into the QR code — a `dioteko://verify?...` deep link or the raw external reference, caller's choice. */
  qrPayload: string;
  issuedAt: Date;
  validUntil: Date;
  /** Printed under "Blockchain Verification" — see `AdminCertificatesService.issueForRequest`'s doc comment on which hash this should be. */
  documentHash: string;
  blockchainAnchor: CertificateBlockchainAnchorDisplay;
  /** True when no agent reviewed the data (automatic issuance): the PDF states it is declared, not verified. */
  declaredNotVerified?: boolean;
}

export interface GeneratePdfResult {
  pdfBuffer: Buffer;
  qrCodeDataUrl: string | null;
}

/**
 * Pure PDF/QR generation, ported from `backend/src/services/certificateService.js`'s
 * `createPDF` (layout/fields) + its `QRCode.toDataURL` call. Deliberately has
 * no DB access and no filesystem writes — it hands back an in-memory
 * `pdfBuffer` (built by piping `PDFDocument`'s stream into an in-memory
 * chunk collector, instead of `fs.createWriteStream` like the old service
 * did) so the caller (`AdminCertificatesService`) decides what to do with
 * it: persist to disk, stream straight to an HTTP response, etc. See that
 * service's doc comment for the storage approach actually used in this
 * round.
 */
@Injectable()
export class CertificatePdfService {
  private readonly logger = new Logger(CertificatePdfService.name);

  async generatePdf(params: GeneratePdfParams): Promise<GeneratePdfResult> {
    const { certificateType, holderData, externalReference, qrPayload, issuedAt, validUntil, documentHash, blockchainAnchor, declaredNotVerified } =
      params;

    this.logger.log(`[START] generatePdf certificateType=${certificateType} externalReference=${externalReference}`);

    let qrCodeDataUrl: string | null = null;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 180,
      });
    } catch (qrError) {
      const message = qrError instanceof Error ? qrError.message : 'Unknown QR error';
      this.logger.warn(`[RESULT] Unable to render QR code in PDF: ${message}`);
    }

    const pdfBuffer = await this.renderPdfBuffer({
      certificateType,
      holderData,
      externalReference,
      issuedAt,
      validUntil,
      documentHash,
      blockchainAnchor,
      qrCodeDataUrl,
      declaredNotVerified: declaredNotVerified === true,
    });

    this.logger.log(`[RESULT] generatePdf success externalReference=${externalReference} bytes=${pdfBuffer.length}`);

    return { pdfBuffer, qrCodeDataUrl };
  }

  private renderPdfBuffer(args: {
    certificateType: string;
    holderData: Record<string, unknown>;
    externalReference: string;
    issuedAt: Date;
    validUntil: Date;
    documentHash: string;
    blockchainAnchor: CertificateBlockchainAnchorDisplay;
    qrCodeDataUrl: string | null;
    declaredNotVerified: boolean;
  }): Promise<Buffer> {
    const {
      certificateType,
      holderData,
      externalReference,
      issuedAt,
      validUntil,
      documentHash,
      blockchainAnchor,
      qrCodeDataUrl,
      declaredNotVerified,
    } = args;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('Official Certificate', { align: 'center' });
      doc.moveDown();
      doc.fontSize(18).text(getCertificateTitle(certificateType), { align: 'center' });
      doc.moveDown(2);

      // Certificate content
      doc.fontSize(12).font('Helvetica');
      doc.text(`Certificate ID: ${externalReference}`);
      doc.text(`Issue Date: ${issuedAt.toLocaleDateString()}`);
      doc.text(`Valid Until: ${validUntil.toLocaleDateString()}`);
      doc.moveDown();

      // Personal information
      doc.fontSize(14).font('Helvetica-Bold').text('Personal Information:');
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica');

      const data = holderData as Record<string, string | undefined>;
      if (data.fullName) doc.text(`Full Name: ${data.fullName}`);
      if (data.dateOfBirth) doc.text(`Date of Birth: ${data.dateOfBirth}`);
      if (data.placeOfBirth) doc.text(`Place of Birth: ${data.placeOfBirth}`);
      if (data.fatherName) doc.text(`Father's Name: ${data.fatherName}`);
      if (data.motherName) doc.text(`Mother's Name: ${data.motherName}`);
      if (data.nationality) doc.text(`Nationality: ${data.nationality}`);
      if (data.idNumber) doc.text(`ID Number: ${data.idNumber}`);

      if (declaredNotVerified) {
        doc.moveDown();
        doc.fontSize(10).font('Helvetica-Oblique').text('Information declared by the holder, not verified by the administration.');
        doc.font('Helvetica');
      }

      doc.moveDown(2);

      // Blockchain verification section
      doc.fontSize(14).font('Helvetica-Bold').text('Blockchain Verification:');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Document Hash: ${documentHash.substring(0, 32)}...`);
      doc.text(`Transaction ID: ${blockchainAnchor.txId.substring(0, 32)}...`);
      doc.text(`Network: Bitcoin ${blockchainAnchor.network}`);
      doc.text(`Timestamp: ${blockchainAnchor.timestamp}`);
      doc.moveDown();

      try {
        if (qrCodeDataUrl) {
          doc.image(qrCodeDataUrl, doc.page.width - 170, doc.y - 10, { width: 120 });
        }
      } catch (qrError) {
        const message = qrError instanceof Error ? qrError.message : 'Unknown QR error';
        this.logger.warn(`[RESULT] Unable to place QR code image in PDF: ${message}`);
      }

      // Footer
      doc.moveDown(2);
      doc.fontSize(10).text('This certificate is digitally signed and anchored on the Bitcoin blockchain.', {
        align: 'center',
      });
      doc.text('Verify authenticity at: [Verification URL]', { align: 'center' });

      // Signature line
      doc.moveDown(2);
      doc.text('_____________________', { align: 'right' });
      doc.text('Authorized Signature', { align: 'right' });

      doc.end();
    });
  }
}
