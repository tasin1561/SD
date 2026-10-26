import { Global, Module } from '@nestjs/common';
import { SellerUatFieldsController } from './controllers/seller-uat-fields.controller';
import { StoreUatFieldsController } from './controllers/store-uat-fields.controller';
import { UatFieldsService } from './services/uat-fields.service';

/**
 * UAT Settings — the owner's switches for things the client asked to
 * have taken off a form during UAT.
 *
 * `@Global` deliberately. The answer is needed in three unrelated
 * places — two console controllers and the CSV importer — and it has no
 * dependencies of its own beyond Prisma. Threading it through module
 * imports would mean every future consumer editing a module graph to
 * ask a question that has one answer for the whole process.
 *
 * The consoles read it through their own guarded controller rather than
 * a shared one, so the answer is never served to an unauthenticated
 * caller and each console asks on its own origin (FE-3).
 */
@Global()
@Module({
  controllers: [SellerUatFieldsController, StoreUatFieldsController],
  providers: [UatFieldsService],
  exports: [UatFieldsService],
})
export class UatSettingsModule {}
