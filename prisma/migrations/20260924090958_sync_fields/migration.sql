-- AlterEnum
ALTER TYPE "IntegrationStatus" ADD VALUE 'NEEDS_REAUTH';

-- AlterTable
ALTER TABLE "FeeConfig" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCountryCode" TEXT;
