import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../../modules/identity/entities/role.entity';
import { ConvertQueryDto } from '../dto/convert-query.dto';
import { ExchangeRateQueryDto } from '../dto/exchange-rate-query.dto';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { BitnobBalancesService } from '../services/bitnob-balances.service';
import { BitnobPayoutsService } from '../services/bitnob-payouts.service';
import { BitnobRatesService } from '../services/bitnob-rates.service';
import { BitnobTransactionsService } from '../services/bitnob-transactions.service';
import { BitnobReadController } from './bitnob-read.controller';

describe('BitnobReadController', () => {
  let balances: { list: jest.Mock; getByCurrency: jest.Mock };
  let rates: { getPair: jest.Mock; listByBase: jest.Mock; convert: jest.Mock };
  let transactions: { list: jest.Mock; getById: jest.Mock };
  let payouts: {
    supportedCountries: jest.Mock;
    countryRequirements: jest.Mock;
    banks: jest.Mock;
    limits: jest.Mock;
  };
  let controller: BitnobReadController;

  beforeEach(() => {
    balances = {
      list: jest.fn().mockResolvedValue({ accounts: [] }),
      getByCurrency: jest.fn().mockResolvedValue({ currency: 'USDT' }),
    };
    rates = {
      getPair: jest.fn().mockResolvedValue({ pair: true }),
      listByBase: jest.fn().mockResolvedValue({ base: true }),
      convert: jest.fn().mockResolvedValue({ converted: true }),
    };
    transactions = {
      list: jest.fn().mockResolvedValue({ transactions: [] }),
      getById: jest.fn().mockResolvedValue({ transaction_id: 't1' }),
    };
    payouts = {
      supportedCountries: jest.fn().mockResolvedValue({ countries: [] }),
      countryRequirements: jest.fn().mockResolvedValue({ code: 'NG' }),
      banks: jest.fn().mockResolvedValue({ banks: [] }),
      limits: jest.fn().mockResolvedValue({ limits: {} }),
    };
    controller = new BitnobReadController(
      balances as unknown as BitnobBalancesService,
      rates as unknown as BitnobRatesService,
      transactions as unknown as BitnobTransactionsService,
      payouts as unknown as BitnobPayoutsService,
    );
  });

  describe('GET exchange-rates', () => {
    it('?base= routes to listByBase and wraps as { success, rates }', async () => {
      const res = await controller.exchangeRates({ base: 'USDT' } as ExchangeRateQueryDto);

      expect(rates.listByBase).toHaveBeenCalledWith('USDT');
      expect(rates.getPair).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, rates: { base: true } });
    });

    it('?from=&to= routes to getPair and wraps as { success, rate }', async () => {
      const res = await controller.exchangeRates({ from: 'USDT', to: 'NGN' } as ExchangeRateQueryDto);

      expect(rates.getPair).toHaveBeenCalledWith('USDT', 'NGN');
      expect(res).toEqual({ success: true, rate: { pair: true } });
    });

    it('neither base nor from/to -> BadRequestException', async () => {
      await expect(controller.exchangeRates({} as ExchangeRateQueryDto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('both base and from/to -> BadRequestException (ambiguous)', async () => {
      await expect(
        controller.exchangeRates({ base: 'USDT', from: 'USDT', to: 'NGN' } as ExchangeRateQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rates.listByBase).not.toHaveBeenCalled();
      expect(rates.getPair).not.toHaveBeenCalled();
    });

    it('base plus a partial from (no to) is still ambiguous -> BadRequestException', async () => {
      await expect(
        controller.exchangeRates({ base: 'USDT', from: 'USDT' } as ExchangeRateQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('from without to -> BadRequestException', async () => {
      await expect(controller.exchangeRates({ from: 'USDT' } as ExchangeRateQueryDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('GET exchange-rates/convert', () => {
    it('all three present and positive -> convert, wrapped as { success, conversion }', async () => {
      const res = await controller.convertRate({ from: 'USDT', to: 'NGN', amount: '10' } as ConvertQueryDto);

      expect(rates.convert).toHaveBeenCalledWith('USDT', 'NGN', '10');
      expect(res).toEqual({ success: true, conversion: { converted: true } });
    });

    it('missing amount -> BadRequestException', async () => {
      await expect(
        controller.convertRate({ from: 'USDT', to: 'NGN' } as ConvertQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rates.convert).not.toHaveBeenCalled();
    });

    it('missing from -> BadRequestException', async () => {
      await expect(
        controller.convertRate({ to: 'NGN', amount: '10' } as ConvertQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('non-positive amount -> BadRequestException', async () => {
      await expect(
        controller.convertRate({ from: 'USDT', to: 'NGN', amount: '0' } as ConvertQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rates.convert).not.toHaveBeenCalled();
    });
  });

  describe('response envelopes and query pass-through', () => {
    it('balances -> { success, balances }', async () => {
      expect(await controller.listBalances()).toEqual({ success: true, balances: { accounts: [] } });
    });

    it('balances/:currency -> { success, balance }', async () => {
      expect(await controller.getBalanceByCurrency('USDT')).toEqual({
        success: true,
        balance: { currency: 'USDT' },
      });
      expect(balances.getByCurrency).toHaveBeenCalledWith('USDT');
    });

    it('transactions -> { success, transactions } and forwards all query opts', async () => {
      await controller.listTransactions({ limit: 5, status: 'SETTLED' } as ListTransactionsQueryDto);
      expect(transactions.list).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 5,
        status: 'SETTLED',
        type: undefined,
        currency: undefined,
      });
    });

    it('transactions/:id -> { success, transaction }', async () => {
      expect(await controller.getTransactionById('t1')).toEqual({
        success: true,
        transaction: { transaction_id: 't1' },
      });
      expect(transactions.getById).toHaveBeenCalledWith('t1');
    });
  });

  describe('payout reference data', () => {
    it('payouts/supported-countries -> { success, countries }', async () => {
      expect(await controller.payoutSupportedCountries()).toEqual({
        success: true,
        countries: { countries: [] },
      });
    });

    it('payouts/supported-countries/:country forwards the path param', async () => {
      await controller.payoutCountryRequirements('NG');
      expect(payouts.countryRequirements).toHaveBeenCalledWith('NG');
    });

    it('payouts/banks/:countryCode forwards the path param', async () => {
      await controller.payoutBanks('KE');
      expect(payouts.banks).toHaveBeenCalledWith('KE');
    });

    it('payouts/limits -> { success, limits }', async () => {
      expect(await controller.payoutLimits()).toEqual({ success: true, limits: { limits: {} } });
    });
  });

  describe('@Roles metadata (treasury tier)', () => {
    it('class-level tier is issuer/admin only (no verifier)', () => {
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController)).toEqual([RoleCode.ISSUER, RoleCode.ADMIN]);
    });

    it('both exchange-rate handlers add verifier via a handler-level override', () => {
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController.prototype.exchangeRates)).toEqual([
        RoleCode.ISSUER,
        RoleCode.ADMIN,
        RoleCode.VERIFIER,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController.prototype.convertRate)).toEqual([
        RoleCode.ISSUER,
        RoleCode.ADMIN,
        RoleCode.VERIFIER,
      ]);
    });

    it('balances/transactions handlers have no override, so the class tier applies', () => {
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController.prototype.listBalances)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController.prototype.getBalanceByCurrency)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController.prototype.listTransactions)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, BitnobReadController.prototype.getTransactionById)).toBeUndefined();
    });
  });
});
