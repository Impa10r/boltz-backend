import { Request, Response, Router } from 'express';
import Logger from '../../../Logger';
import { getHexString, stringify } from '../../../Utils';
import { SwapVersion } from '../../../consts/Enums';
import RateProviderTaproot from '../../../rates/providers/RateProviderTaproot';
import Service from '../../../service/Service';
import Controller from '../../Controller';
import {
  checkPreimageHashLength,
  createdResponse,
  errorResponse,
  successResponse,
  validateRequest,
} from '../../Utils';
import RouterBase from './RouterBase';

class SwapRouter extends RouterBase {
  constructor(
    logger: Logger,
    private readonly service: Service,
    private readonly controller: Controller,
  ) {
    super(logger, 'swap');
  }

  public getRouter = () => {
    /**
     * @openapi
     * components:
     *   schemas:
     *     SwapTreeLeaf:
     *       type: object
     *       properties:
     *         version:
     *           type: number
     *           description: Tapscript version
     *         output:
     *           type: string
     *           description: Script encoded as HEX
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     SwapTree:
     *       type: object
     *       properties:
     *         claimLeaf:
     *           $ref: '#/components/schemas/SwapTreeLeaf'
     *         refundLeaf:
     *           $ref: '#/components/schemas/SwapTreeLeaf'
     */

    const router = Router();

    /**
     * @openapi
     * tags:
     *   name: Swap
     *   description: Generic Swap related endpoints
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     SwapStatus:
     *       type: object
     *       properties:
     *         status:
     *           type: string
     *           description: Status of the Swap
     *         zeroConfRejected:
     *           type: boolean
     *           description: Whether 0-conf was accepted for the lockup transaction of the Submarine Swap
     *         transaction:
     *           type: object
     *           description: Details of the lockup transaction of a Reverse Swap
     *           properties:
     *             id:
     *               type: string
     *               description: ID of the transaction
     *             hex:
     *               type: string
     *               description: Raw hex of the transaction
     */

    /**
     * @openapi
     * /swap/{id}:
     *   get:
     *     tags: [Swap]
     *     description: Get the status of a Swap
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: ID of the Swap
     *     responses:
     *       '200':
     *         description: The latest status of the Swap
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SwapStatus'
     *       '404':
     *         description: When no Swap with the ID could be found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    router.get('/:id', this.handleError(this.getSwapStatus));

    /**
     * @openapi
     * tags:
     *   name: Submarine
     *   description: Submarine Swap related endpoints
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     SubmarinePair:
     *       type: object
     *       properties:
     *         hash:
     *           type: string
     *           description: Hash of the pair that can be used when creating the Submarine Swap to ensure the information of the client is up-to-date
     *         rate:
     *           type: number
     *           description: Exchange rate of the pair
     *         limits:
     *           type: object
     *           properties:
     *             minimal:
     *               type: number
     *               description: Minimal amount that can be swapped in satoshis
     *             maximal:
     *               type: number
     *               description: Maximal amount that can be swapped in satoshis
     *             maximalZeroConfAmount:
     *               type: number
     *               description: Maximal amount that will be accepted 0-conf in satoshis
     *         fees:
     *           type: object
     *           properties:
     *             percentage:
     *               type: number
     *               description: Relative fee that will be charged in percent
     *             minerFees:
     *               type: number
     *               description: Absolute miner fee that will be charged in satoshis
     */

    /**
     * @openapi
     * /swap/submarine:
     *   get:
     *     description: Possible pairs for Submarine Swaps
     *     tags: [Submarine]
     *     responses:
     *       '200':
     *         description: Dictionary of the from -> to currencies that can be used in a Submarine Swap
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: object
     *                 additionalProperties:
     *                   $ref: '#/components/schemas/SubmarinePair'
     */
    router.get('/submarine', this.handleError(this.getSubmarine));

    /**
     * @openapi
     * components:
     *   schemas:
     *     SubmarineRequest:
     *       type: object
     *       properties:
     *         from:
     *           type: string
     *           required: true
     *           description: The asset that is sent onchain
     *         to:
     *           type: string
     *           required: true
     *           description: The asset that is received on lightning
     *         invoice:
     *           type: string
     *           required: true
     *           description: BOLT11 invoice that should be paid on lightning
     *         refundPublicKey:
     *           type: string
     *           required: true
     *           description: Public key with which the Submarine Swap can be refunded encoded as HEX
     *         pairHash:
     *           type: string
     *         referralId:
     *           type: string
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     SubmarineResponse:
     *       type: object
     *       properties:
     *         id:
     *           type: string
     *           description: ID of the created Submarine Swap
     *         bip21:
     *           type: string
     *           description: BIP21 for the onchain payment request
     *         address:
     *           type: string
     *           description: Onchain HTLC address
     *         swapTree:
     *           $ref: '#/components/schemas/SwapTree'
     *         claimPublicKey:
     *           type: string
     *           description: Public key of Boltz that will be used to sweep the onchain HTLC
     *         timeoutBlockHeight:
     *           type: number
     *           description: Timeout block height of the onchain HTLC
     *         acceptZeroConf:
     *           type: boolean
     *           description: Whether 0-conf will be accepted assuming the transaction does not signal RBF and has a reasonably high fee
     *         expectedAmount:
     *           type: number
     *           description: Amount that is expected to be sent to the onchain HTLC address in satoshis
     *         blindingKey:
     *           type: string
     *           description: Liquid blinding private key encoded as HEX
     */

    /**
     * @openapi
     * /swap/submarine:
     *   post:
     *     description: Create a new Submarine Swap from onchain to lightning
     *     tags: [Submarine]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/SubmarineRequest'
     *     responses:
     *       '201':
     *         description: The created Submarine Swap
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SubmarineResponse'
     *       '400':
     *         description: Error that caused the Submarine Swap creation to fail
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    router.post('/submarine', this.handleError(this.createSubmarine));

    /**
     * @openapi
     * components:
     *   schemas:
     *     SubmarineTransaction:
     *       type: object
     *       properties:
     *         id:
     *           type: string
     *           description: ID the lockup transaction
     *         hex:
     *           type: string
     *           description: Lockup transaction as raw HEX
     *         timeoutBlockHeight:
     *           type: number
     *           description: Block height at which the time-lock expires
     *         timeoutEta:
     *           type: number
     *           description: UNIX timestamp at which the time-lock expires; set if it has not expired already
     */

    /**
     * @openapi
     * /swap/submarine/{id}/transaction:
     *   get:
     *     tags: [Submarine]
     *     description: Get the lockup transaction of a Submarine Swap
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: ID of the Submarine Swap
     *     responses:
     *       '200':
     *         description: The lockup transaction of the Submarine Swap and accompanying information
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SubmarineTransaction'
     *       '400':
     *         description: Error that caused the request to fail
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    router.get(
      '/submarine/:id/transaction',
      this.handleError(this.getSubmarineTransaction),
    );

    /**
     * @openapi
     * components:
     *   schemas:
     *     SubmarineRefundRequest:
     *       type: object
     *       properties:
     *         id:
     *           type: string
     *           required: true
     *           description: ID of the Submarine Swap that should be refunded
     *         pubNonce:
     *           type: string
     *           required: true
     *           description: Public nonce of the client for the session encoded as HEX
     *         transaction:
     *           type: string
     *           required: true
     *           description: Transaction which should be signed encoded as HEX
     *         index:
     *           type: number
     *           required: true
     *           description: Index of the input of the transaction that should be signed
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     PartialSignature:
     *       type: object
     *       properties:
     *         pubNonce:
     *           type: string
     *           description: Public nonce of Boltz encoded as HEX
     *         partialSignature:
     *           type: string
     *           description: Partial signature encoded as HEX
     */

    /**
     * @openapi
     * /swap/submarine/refund:
     *   post:
     *     description: Requests a partial signature for a cooperative Submarine Swap refund transaction
     *     tags: [Submarine]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/SubmarineRefundRequest'
     *     responses:
     *       '200':
     *         description: A partial signature
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PartialSignature'
     *       '400':
     *         description: Error that caused signature request to fail
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    router.post('/submarine/refund', this.handleError(this.refundSubmarine));

    /**
     * @openapi
     * tags:
     *   name: Reverse
     *   description: Reverse Swap related endpoints
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     ReversePair:
     *       type: object
     *       properties:
     *         hash:
     *           type: string
     *           description: Hash of the pair that can be used when creating the Reverse Swap to ensure the information of the client is up-to-date
     *         rate:
     *           type: number
     *           description: Exchange rate of the pair
     *         limits:
     *           type: object
     *           properties:
     *             minimal:
     *               type: number
     *               description: Minimal amount that can be swapped in satoshis
     *             maximal:
     *               type: number
     *               description: Maximal amount that can be swapped in satoshis
     *         fees:
     *           type: object
     *           properties:
     *             percentage:
     *               type: number
     *               description: Relative fee that will be charged in percent
     *             minerFees:
     *               type: object
     *               properties:
     *                 lockup:
     *                   type: number
     *                   description: Absolute miner fee that will be charged in satoshis
     *                 claim:
     *                   type: number
     *                   description: Absolute miner fee that we estimate for the claim transaction in satoshis
     */

    /**
     * @openapi
     * /swap/reverse:
     *   get:
     *     description: Possible pairs for Reverse Swaps
     *     tags: [Reverse]
     *     responses:
     *       '200':
     *         description: Dictionary of the from -> to currencies that can be used in a Reverse Swap
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: object
     *                 additionalProperties:
     *                   $ref: '#/components/schemas/ReversePair'
     */
    router.get('/reverse', this.handleError(this.getReverse));

    /**
     * @openapi
     * components:
     *   schemas:
     *     ReverseRequest:
     *       type: object
     *       properties:
     *         from:
     *           type: string
     *           required: true
     *           description: The asset that is sent on lightning
     *         to:
     *           type: string
     *           required: true
     *           description: The asset that is received onchain
     *         preimageHash:
     *           type: string
     *           required: true
     *           description: SHA-256 hash of the preimage of the Reverse Swap encoded as HEX
     *         claimPublicKey:
     *           type: string
     *           required: true
     *           description: Public key with which the Reverse Swap can be claimed encoded as HEX
     *         invoiceAmount:
     *           type: string
     *           description: Amount for which the invoice should be; conflicts with "onchainAmount"
     *         onchainAmount:
     *           type: string
     *           description: Amount that should be locked in the onchain HTLC; conflicts with "invoiceAmount"
     *         pairHash:
     *           type: string
     *         referralId:
     *           type: string
     */

    /**
     * @openapi
     * components:
     *   schemas:
     *     ReverseResponse:
     *       type: object
     *       properties:
     *         id:
     *           type: string
     *           description: ID of the created Reverse Swap
     *         invoice:
     *           type: string
     *           description: Hold invoice of the Reverse Swap
     *         swapTree:
     *           $ref: '#/components/schemas/SwapTree'
     *         lockupAddress:
     *           type: string
     *           description: HTLC address in which coins will be locked
     *         refundPublicKey:
     *           type: string
     *           description: Public key of Boltz that will be used to refund the onchain HTLC
     *         timeoutBlockHeight:
     *           type: number
     *           description: Timeout block height of the onchain HTLC
     *         onchainAmount:
     *           type: number
     *           description: Amount that will be locked in the onchain HTLC
     *         blindingKey:
     *           type: string
     *           description: Liquid blinding private key encoded as HEX
     */

    /**
     * @openapi
     * /swap/reverse:
     *   post:
     *     description: Create a new Reverse Swap from lightning to onchain
     *     tags: [Reverse]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ReverseRequest'
     *     responses:
     *       '201':
     *         description: The created Reverse Swap
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ReverseResponse'
     *       '400':
     *         description: Error that caused the Reverse Swap creation to fail
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    router.post('/reverse', this.handleError(this.createReverse));

    /**
     * @openapi
     * components:
     *   schemas:
     *     ReverseClaimRequest:
     *       type: object
     *       properties:
     *         id:
     *           type: string
     *           required: true
     *           description: ID of the Reverse Swap that should be refunded
     *         preimage:
     *           type: string
     *           required: true
     *           description: Preimage of the Reverse Swap encoded as HEX
     *         pubNonce:
     *           type: string
     *           required: true
     *           description: Public nonce of the client for the session encoded as HEX
     *         transaction:
     *           type: string
     *           required: true
     *           description: Transaction which should be signed encoded as HEX
     *         index:
     *           type: number
     *           required: true
     *           description: Index of the input of the transaction that should be signed
     */

    /**
     * @openapi
     * /swap/reverse/claim:
     *   post:
     *     description: Requests a partial signature for a cooperative Reverse Swap claim transaction
     *     tags: [Reverse]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ReverseClaimRequest'
     *     responses:
     *       '200':
     *         description: A partial signature
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PartialSignature'
     *       '400':
     *         description: Error that caused signature request to fail
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    router.post('/reverse/claim', this.handleError(this.claimReverse));

    return router;
  };

  private getSwapStatus = (req: Request, res: Response) => {
    const { id } = validateRequest(req.params, [
      { name: 'id', type: 'string' },
    ]);

    const response = this.controller.pendingSwapInfos.get(id);

    if (response) {
      successResponse(res, response);
    } else {
      errorResponse(
        this.logger,
        req,
        res,
        `could not find swap with id: ${id}`,
        404,
      );
    }
  };

  private getSubmarine = (_req: Request, res: Response) =>
    successResponse(
      res,
      RateProviderTaproot.serializePairs(
        this.service.rateProvider.providers[SwapVersion.Taproot].submarinePairs,
      ),
    );

  private createSubmarine = async (req: Request, res: Response) => {
    const { to, from, invoice, pairHash, referralId, refundPublicKey } =
      validateRequest(req.body, [
        { name: 'to', type: 'string' },
        { name: 'from', type: 'string' },
        { name: 'invoice', type: 'string' },
        { name: 'refundPublicKey', type: 'string', hex: true },
        { name: 'pairHash', type: 'string', optional: true },
        { name: 'referralId', type: 'string', optional: true },
      ]);

    const { pairId, orderSide } = this.service.convertToPairAndSide(from, to);

    const response = await this.service.createSwapWithInvoice(
      pairId,
      orderSide,
      refundPublicKey,
      invoice.toLowerCase(),
      pairHash,
      referralId,
      undefined,
      SwapVersion.Taproot,
    );

    this.logger.verbose(`Created new Swap with id: ${response.id}`);
    this.logger.silly(`Swap ${response.id}: ${stringify(response)}`);

    createdResponse(res, response);
  };

  private getSubmarineTransaction = async (req: Request, res: Response) => {
    const { id } = validateRequest(req.params, [
      { name: 'id', type: 'string' },
    ]);

    const { transactionHex, transactionId, timeoutBlockHeight, timeoutEta } =
      await this.service.getSwapTransaction(id);
    successResponse(res, {
      id: transactionId,
      hex: transactionHex,
      timeoutBlockHeight,
      timeoutEta,
    });
  };

  private refundSubmarine = async (req: Request, res: Response) => {
    const { id, pubNonce, index, transaction } = validateRequest(req.body, [
      { name: 'id', type: 'string' },
      { name: 'index', type: 'number' },
      { name: 'pubNonce', type: 'string', hex: true },
      { name: 'transaction', type: 'string', hex: true },
    ]);

    const sig = await this.service.musigSigner.signSwapRefund(
      id,
      pubNonce,
      transaction,
      index,
    );

    successResponse(res, {
      pubNonce: getHexString(sig.pubNonce),
      partialSignature: getHexString(sig.signature),
    });
  };

  private getReverse = (_req: Request, res: Response) =>
    successResponse(
      res,
      RateProviderTaproot.serializePairs(
        this.service.rateProvider.providers[SwapVersion.Taproot].reversePairs,
      ),
    );

  private createReverse = async (req: Request, res: Response) => {
    const {
      to,
      from,
      pairHash,
      referralId,
      routingNode,
      preimageHash,
      invoiceAmount,
      onchainAmount,
      claimPublicKey,
    } = validateRequest(req.body, [
      { name: 'to', type: 'string' },
      { name: 'from', type: 'string' },
      { name: 'preimageHash', type: 'string', hex: true },
      { name: 'claimPublicKey', type: 'string', hex: true },
      { name: 'pairHash', type: 'string', optional: true },
      { name: 'referralId', type: 'string', optional: true },
      { name: 'routingNode', type: 'string', optional: true },
      { name: 'invoiceAmount', type: 'number', optional: true },
      { name: 'onchainAmount', type: 'number', optional: true },
    ]);

    checkPreimageHashLength(preimageHash);

    const { pairId, orderSide } = this.service.convertToPairAndSide(from, to);
    const response = await this.service.createReverseSwap({
      pairId,
      pairHash,
      orderSide,
      referralId,
      routingNode,
      preimageHash,
      invoiceAmount,
      onchainAmount,
      claimPublicKey,
      prepayMinerFee: false,
      version: SwapVersion.Taproot,
    });

    this.logger.verbose(`Created Reverse Swap with id: ${response.id}`);
    this.logger.silly(`Reverse swap ${response.id}: ${stringify(response)}`);

    createdResponse(res, response);
  };

  private claimReverse = async (req: Request, res: Response) => {
    const { id, preimage, pubNonce, index, transaction } = validateRequest(
      req.body,
      [
        { name: 'id', type: 'string' },
        { name: 'index', type: 'number' },
        { name: 'preimage', type: 'string', hex: true },
        { name: 'pubNonce', type: 'string', hex: true },
        { name: 'transaction', type: 'string', hex: true },
      ],
    );

    const sig = await this.service.musigSigner.signReverseSwapClaim(
      id,
      preimage,
      pubNonce,
      transaction,
      index,
    );

    successResponse(res, {
      pubNonce: getHexString(sig.pubNonce),
      partialSignature: getHexString(sig.signature),
    });
  };
}

export default SwapRouter;