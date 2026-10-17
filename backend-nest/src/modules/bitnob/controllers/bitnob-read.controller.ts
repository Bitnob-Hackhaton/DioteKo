import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../../modules/identity/entities/role.entity';
import { ConvertQueryDto } from '../dto/convert-query.dto';
import { ExchangeRateQueryDto } from '../dto/exchange-rate-query.dto';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { BitnobBalancesService } from '../services/bitnob-balances.service';
import { BitnobPayoutsService } from '../services/bitnob-payouts.service';
import { BitnobRatesService } from '../services/bitnob-rates.service';
import { BitnobTransactionsService } from '../services/bitnob-transactions.service';

/**
 * `/api/bitnob/{balances,exchange-rates,transactions}` — read-only Bitnob
 * data.
 *
 * Balances and transaction history are DioteKo's own treasury data:
 * `issuer`/`admin` only (class-level `@Roles`). `verifier` in this codebase
 * is an external third-party organisation (see `access-log.entity.ts`
 * `verifier_organization`, `consent.entity.ts`) and must not see the
 * platform's wallet balances or payout/transaction history.
 *
 * FX rates carry no treasury information, so the two `exchange-rates` routes
 * carry a handler-level `@Roles` that additionally allows `verifier`
 * (`RolesGuard` uses `getAllAndOverride([handler, class])`, so the handler
 * override wins).
 *
 * The `payouts/{supported-countries,banks,limits}` routes are Bitnob payout
 * REFERENCE data (corridors, bank directories, min/max) — not treasury data,
 * so they sit at the class tier (`issuer`/`admin`). They live here rather
 * than on `BitnobMoneyController` (`admin`-only, money-moving) and this
 * controller MUST be registered before `BitnobMoneyController` so its static
 * `payouts/*` segments win over that controller's `payouts/:id`.
 *
 * Money-moving routes + `payouts/account-lookup` stay on
 * `BitnobMoneyController` (`admin`); the credentials probe (`whoami`) on
 * `BitnobIdentityController` (`admin`).
 */
@ApiTags('bitnob')
@ApiBearerAuth()
@Controller('bitnob')
@Roles(RoleCode.ISSUER, RoleCode.ADMIN)
export class BitnobReadController {
  constructor(
    private readonly balances: BitnobBalancesService,
    private readonly rates: BitnobRatesService,
    private readonly transactions: BitnobTransactionsService,
    private readonly payouts: BitnobPayoutsService,
  ) {}

  @Get('balances')
  async listBalances() {
    return { success: true, balances: await this.balances.list() };
  }

  @Get('balances/:currency')
  async getBalanceByCurrency(@Param('currency') currency: string) {
    return { success: true, balance: await this.balances.getByCurrency(currency) };
  }

  @Get('exchange-rates/convert')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN, RoleCode.VERIFIER)
  async convertRate(@Query() query: ConvertQueryDto) {
    if (!query.from || !query.to || !query.amount) {
      throw new BadRequestException('from, to and amount query params are all required');
    }
    if (!(Number(query.amount) > 0)) {
      throw new BadRequestException('amount must be a positive number');
    }
    return { success: true, conversion: await this.rates.convert(query.from, query.to, query.amount) };
  }

  @Get('exchange-rates')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN, RoleCode.VERIFIER)
  async exchangeRates(@Query() query: ExchangeRateQueryDto) {
    const hasBase = Boolean(query.base);
    const hasFromOrTo = Boolean(query.from) || Boolean(query.to);

    if (hasBase && hasFromOrTo) {
      throw new BadRequestException('Provide either base= or from= & to=, not both');
    }
    if (hasBase) {
      return { success: true, rates: await this.rates.listByBase(query.base as string) };
    }
    if (!query.from || !query.to) {
      throw new BadRequestException('Provide either base= or from= & to=');
    }
    return { success: true, rate: await this.rates.getPair(query.from, query.to) };
  }

  // --- Bitnob payout reference data (static segments first) ---

  @Get('payouts/supported-countries')
  async payoutSupportedCountries() {
    return { success: true, countries: await this.payouts.supportedCountries() };
  }

  @Get('payouts/limits')
  async payoutLimits() {
    return { success: true, limits: await this.payouts.limits() };
  }

  @Get('payouts/supported-countries/:country')
  async payoutCountryRequirements(@Param('country') country: string) {
    return { success: true, country: await this.payouts.countryRequirements(country) };
  }

  @Get('payouts/banks/:countryCode')
  async payoutBanks(@Param('countryCode') countryCode: string) {
    return { success: true, banks: await this.payouts.banks(countryCode) };
  }

  @Get('transactions/:id')
  async getTransactionById(@Param('id') id: string) {
    return { success: true, transaction: await this.transactions.getById(id) };
  }

  @Get('transactions')
  async listTransactions(@Query() query: ListTransactionsQueryDto) {
    return {
      success: true,
      transactions: await this.transactions.list({
        cursor: query.cursor,
        limit: query.limit,
        status: query.status,
        type: query.type,
        currency: query.currency,
      }),
    };
  }
}
