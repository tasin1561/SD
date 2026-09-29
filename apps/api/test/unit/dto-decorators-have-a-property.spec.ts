import { globSync, readFileSync } from 'node:fs';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProductDto } from '../../src/modules/catalog-product/dto/create-product.dto';
import { UpdateProductDto } from '../../src/modules/catalog-product/dto/update-product.dto';

/**
 * A decorator stack with NO property under it lands on the NEXT one.
 *
 * TypeScript decorators attach to whatever declaration follows them, so
 * deleting a DTO field's property line while leaving its `@ApiProperty`
 * / `@IsString()` / `@MaxLength()` above the next field silently moves
 * that validation onto the next field. class-validator ANDs the rules,
 * so a field that is now BOTH `@IsInt()` and `@IsString()` can never be
 * satisfied by anything.
 *
 * It happened: `0405ec65 feat(catalog): remove external SKU from the
 * system` removed the product-level external SKU and left its stack
 * behind in both `create-product.dto.ts` and `update-product.dto.ts`,
 * directly above `defaultWeightGrams`. From that commit until this test
 * was written, `POST /seller/products` and `PATCH /seller/products/:id`
 * REFUSED any request carrying a weight — which is the ordinary case,
 * because weight is what the courier prices on. The seller's New product
 * form filled in perfectly and then failed with
 * "defaultWeightGrams must be a string", naming a field they had typed a
 * number into.
 *
 * Nothing else could see it: the DTO compiles, the property's own type
 * is right, and no unit test posted a weight.
 */
describe('DTO decorators always have a property under them', () => {
  it('accepts a numeric default weight on product create', () => {
    const dto = plainToInstance(CreateProductDto, {
      name: 'Rajshahi Silk Kurti',
      externalRef: 'RSH-KURTI',
      defaultWeightGrams: 320,
      defaultDeclaredValueInr: 1750,
    });
    expect(validateSync(dto)).toEqual([]);
  });

  it('accepts a numeric default weight on product update', () => {
    const dto = plainToInstance(UpdateProductDto, { defaultWeightGrams: 320 });
    expect(validateSync(dto)).toEqual([]);
  });

  it('still refuses a weight that is not a whole number of grams', () => {
    const dto = plainToInstance(CreateProductDto, { name: 'x', defaultWeightGrams: 'heavy' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  /**
   * The structural half: find the fingerprint anywhere, so the NEXT
   * removed field cannot do this again. A stack is orphaned when an
   * `@ApiProperty` is followed by another `@ApiProperty` with no
   * property declaration between them.
   */
  it('has no orphaned decorator stack in any DTO', () => {
    const files = globSync('src/**/*.dto.ts', { cwd: `${__dirname}/../..` });
    const orphans: string[] = [];

    for (const relative of files) {
      const lines = readFileSync(`${__dirname}/../../${relative}`, 'utf8').split('\n');
      let openedAt: number | null = null;
      for (const [index, raw] of lines.entries()) {
        const line = raw.trim();
        // A one-line declaration carries its property with it.
        const isDeclarationLine = /[;{]\s*$/.test(line) && /\b\w+[?!]?:/.test(line);
        if (line.startsWith('@ApiProperty') && !isDeclarationLine) {
          if (openedAt !== null) orphans.push(`${relative}:${openedAt + 1}`);
          openedAt = index;
        } else if (
          line !== '' &&
          !line.startsWith('@') &&
          !line.startsWith('//') &&
          !line.startsWith('*') &&
          !line.startsWith('/*')
        ) {
          openedAt = null;
        }
      }
    }

    expect(orphans).toEqual([]);
  });
});
