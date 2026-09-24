-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED', 'PENDING_REDACTION');

-- CreateEnum
CREATE TYPE "CogsSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'SHOPIFY_INVENTORY', 'BULK_EDIT');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('EXCLUDE_COLLECTED_TAX', 'INCLUDE_TAX_AS_REVENUE', 'UNCONFIGURED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('SOFTWARE', 'WAREHOUSE', 'CONTRACTORS', 'PACKAGING', 'FULFILLMENT', 'PAYROLL', 'AGENCY', 'MARKETING_OTHER', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseRecurrence" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ExpenseAllocation" AS ENUM ('STORE', 'PER_ORDER');

-- CreateEnum
CREATE TYPE "AdProvider" AS ENUM ('META', 'GOOGLE', 'TIKTOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'ERROR', 'EXPIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "LeakType" AS ENUM ('AD_SPEND_INCREASE', 'MARGIN_SHRINK', 'REFUND_RATE_HIGH', 'MISSING_COGS', 'SHIPPING_COST_INCREASE', 'DISCOUNT_INCREASE', 'PAYMENT_FEE_CHANGE', 'NEAR_BREAK_EVEN_PRODUCT', 'LOSS_MAKING_PRODUCT', 'LOW_MARGIN_ORDERS', 'EXPENSE_SPIKE', 'DATA_STALE');

-- CreateEnum
CREATE TYPE "LeakSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LeakStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AiRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DigestKind" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('HISTORICAL_ORDERS', 'INCREMENTAL_ORDERS', 'PRODUCTS', 'AD_SPEND', 'RECALCULATE', 'DETECT_LEAKS', 'DIGEST', 'SHOP_INFO');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'DEAD_LETTER', 'IGNORED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PENDING', 'CANCELLED', 'EXPIRED', 'FROZEN');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "shopifyUserId" BIGINT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" BIGINT,
    "name" TEXT,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ianaTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "countryCode" TEXT,
    "planName" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "onboardingStep" TEXT NOT NULL DEFAULT 'welcome',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "grantedScopes" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "status" TEXT,
    "imageUrl" TEXT,
    "shopifyCreatedAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "priceMinor" INTEGER,
    "inventoryItemId" TEXT,
    "shopifyUnitCostMinor" INTEGER,
    "shopifyUnitCostCurrency" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CogsHistory" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "unitCostMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" "CogsSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CogsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderNumber" INTEGER,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "currency" TEXT NOT NULL,
    "presentmentCurrency" TEXT,
    "customerShopifyId" TEXT,
    "customerEmailHash" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "sourceName" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subtotalMinor" INTEGER NOT NULL,
    "totalDiscountsMinor" INTEGER NOT NULL,
    "totalShippingMinor" INTEGER NOT NULL,
    "totalTaxMinor" INTEGER NOT NULL,
    "totalTipMinor" INTEGER NOT NULL DEFAULT 0,
    "totalDutiesMinor" INTEGER NOT NULL DEFAULT 0,
    "totalPriceMinor" INTEGER NOT NULL,
    "totalRefundedMinor" INTEGER NOT NULL DEFAULT 0,
    "taxesIncluded" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3),
    "cogsMinor" INTEGER,
    "cogsCoverage" INTEGER,
    "paymentFeesMinor" INTEGER,
    "shippingCostMinor" INTEGER,
    "shippingCostSource" TEXT,
    "contributionProfitMinor" INTEGER,
    "calcVersion" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "currentQuantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "requiresShipping" BOOLEAN NOT NULL DEFAULT true,
    "isGiftCard" BOOLEAN NOT NULL DEFAULT false,
    "unitCogsMinor" INTEGER,
    "cogsSource" TEXT,

    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "currency" TEXT NOT NULL,
    "totalRefundedMinor" INTEGER NOT NULL,
    "shippingRefundMinor" INTEGER NOT NULL DEFAULT 0,
    "taxRefundMinor" INTEGER NOT NULL DEFAULT 0,
    "lineItemsJson" JSONB NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gateway" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "feeMinor" INTEGER,
    "feeCurrency" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "percentBps" INTEGER NOT NULL DEFAULT 290,
    "fixedMinor" INTEGER NOT NULL DEFAULT 30,
    "gatewayOverrides" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingCostRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT,
    "flatMinor" INTEGER NOT NULL DEFAULT 0,
    "perItemMinor" INTEGER NOT NULL DEFAULT 0,
    "percentBps" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingCostRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "treatment" "TaxTreatment" NOT NULL DEFAULT 'EXCLUDE_COLLECTED_TAX',
    "regionCode" TEXT,
    "cogsIncludesReclaimableTax" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "recurrence" "ExpenseRecurrence" NOT NULL DEFAULT 'ONE_TIME',
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "allocation" "ExpenseAllocation" NOT NULL DEFAULT 'STORE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" "AdProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "credentialsEnc" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpend" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "spendMinor" INTEGER NOT NULL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "attributedRevenueMinor" INTEGER,
    "attributedConversions" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitSnapshot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "grossSalesMinor" INTEGER NOT NULL,
    "discountsMinor" INTEGER NOT NULL,
    "refundsMinor" INTEGER NOT NULL,
    "netSalesMinor" INTEGER NOT NULL,
    "cogsMinor" INTEGER NOT NULL,
    "grossProfitMinor" INTEGER NOT NULL,
    "shippingRevenueMinor" INTEGER NOT NULL,
    "shippingCostMinor" INTEGER NOT NULL,
    "paymentFeesMinor" INTEGER NOT NULL,
    "adSpendMinor" INTEGER NOT NULL,
    "taxCollectedMinor" INTEGER NOT NULL,
    "otherExpensesMinor" INTEGER NOT NULL,
    "contributionProfitMinor" INTEGER NOT NULL,
    "netProfitMinor" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "confidenceJson" JSONB NOT NULL,
    "calcVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitLeak" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "LeakType" NOT NULL,
    "severity" "LeakSeverity" NOT NULL,
    "status" "LeakStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "aiExplanation" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "impactMinor" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ProfitLeak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiRole" NOT NULL,
    "content" TEXT NOT NULL,
    "groundingJson" JSONB,
    "referencesJson" JSONB,
    "validationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicros" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceDigest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "DigestKind" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "cursor" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "paramsJson" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "apiVersion" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dailyDigest" BOOLEAN NOT NULL DEFAULT false,
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "leakAlerts" BOOLEAN NOT NULL DEFAULT true,
    "minLeakSeverity" "LeakSeverity" NOT NULL DEFAULT 'MEDIUM',
    "email" TEXT,
    "deliveryHour" INTEGER NOT NULL DEFAULT 8,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "shopifySubscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "User_shopifyUserId_key" ON "User"("shopifyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");

-- CreateIndex
CREATE INDEX "Store_organizationId_idx" ON "Store"("organizationId");

-- CreateIndex
CREATE INDEX "Store_status_idx" ON "Store"("status");

-- CreateIndex
CREATE INDEX "Installation_storeId_idx" ON "Installation"("storeId");

-- CreateIndex
CREATE INDEX "Product_storeId_title_idx" ON "Product"("storeId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_shopifyId_key" ON "Product"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "Variant_storeId_sku_idx" ON "Variant"("storeId", "sku");

-- CreateIndex
CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_storeId_shopifyId_key" ON "Variant"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "CogsHistory_storeId_variantId_effectiveFrom_idx" ON "CogsHistory"("storeId", "variantId", "effectiveFrom" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CogsHistory_variantId_effectiveFrom_key" ON "CogsHistory"("variantId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Order_storeId_processedAt_idx" ON "Order"("storeId", "processedAt");

-- CreateIndex
CREATE INDEX "Order_storeId_shopifyUpdatedAt_idx" ON "Order"("storeId", "shopifyUpdatedAt");

-- CreateIndex
CREATE INDEX "Order_storeId_customerShopifyId_idx" ON "Order"("storeId", "customerShopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_shopifyId_key" ON "Order"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "LineItem_orderId_idx" ON "LineItem"("orderId");

-- CreateIndex
CREATE INDEX "LineItem_storeId_variantId_idx" ON "LineItem"("storeId", "variantId");

-- CreateIndex
CREATE INDEX "LineItem_storeId_productId_idx" ON "LineItem"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "LineItem_storeId_shopifyId_key" ON "LineItem"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "Refund_storeId_processedAt_idx" ON "Refund"("storeId", "processedAt");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_storeId_shopifyId_key" ON "Refund"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "Transaction_orderId_idx" ON "Transaction"("orderId");

-- CreateIndex
CREATE INDEX "Transaction_storeId_processedAt_idx" ON "Transaction"("storeId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_storeId_shopifyId_key" ON "Transaction"("storeId", "shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeConfig_storeId_key" ON "FeeConfig"("storeId");

-- CreateIndex
CREATE INDEX "ShippingCostRule_storeId_priority_idx" ON "ShippingCostRule"("storeId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "TaxConfig_storeId_key" ON "TaxConfig"("storeId");

-- CreateIndex
CREATE INDEX "Expense_storeId_startsOn_idx" ON "Expense"("storeId", "startsOn");

-- CreateIndex
CREATE INDEX "AdAccount_storeId_idx" ON "AdAccount"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_storeId_provider_externalId_key" ON "AdAccount"("storeId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "AdSpend_storeId_date_idx" ON "AdSpend"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpend_adAccountId_date_key" ON "AdSpend"("adAccountId", "date");

-- CreateIndex
CREATE INDEX "ProfitSnapshot_storeId_date_idx" ON "ProfitSnapshot"("storeId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProfitSnapshot_storeId_date_key" ON "ProfitSnapshot"("storeId", "date");

-- CreateIndex
CREATE INDEX "ProfitLeak_storeId_status_severity_idx" ON "ProfitLeak"("storeId", "status", "severity");

-- CreateIndex
CREATE INDEX "ProfitLeak_storeId_detectedAt_idx" ON "ProfitLeak"("storeId", "detectedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProfitLeak_storeId_fingerprint_key" ON "ProfitLeak"("storeId", "fingerprint");

-- CreateIndex
CREATE INDEX "AiConversation_storeId_updatedAt_idx" ON "AiConversation"("storeId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_storeId_createdAt_idx" ON "AiUsage"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "IntelligenceDigest_storeId_createdAt_idx" ON "IntelligenceDigest"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceDigest_storeId_kind_periodStart_key" ON "IntelligenceDigest"("storeId", "kind", "periodStart");

-- CreateIndex
CREATE INDEX "SyncJob_storeId_type_status_idx" ON "SyncJob"("storeId", "type", "status");

-- CreateIndex
CREATE INDEX "SyncJob_status_updatedAt_idx" ON "SyncJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_topic_receivedAt_idx" ON "WebhookEvent"("shopDomain", "topic", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_storeId_key" ON "NotificationPreference"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_storeId_key" ON "Subscription"("storeId");

-- CreateIndex
CREATE INDEX "AuditEvent_storeId_createdAt_idx" ON "AuditEvent"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsHistory" ADD CONSTRAINT "CogsHistory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsHistory" ADD CONSTRAINT "CogsHistory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeConfig" ADD CONSTRAINT "FeeConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingCostRule" ADD CONSTRAINT "ShippingCostRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxConfig" ADD CONSTRAINT "TaxConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitSnapshot" ADD CONSTRAINT "ProfitSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitLeak" ADD CONSTRAINT "ProfitLeak_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDigest" ADD CONSTRAINT "IntelligenceDigest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
