CREATE TYPE "PrivacyRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REDACTED');
CREATE TABLE "PrivacyRequest" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "customerShopifyId" TEXT,
  "requestedOrderShopifyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'PENDING',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "fulfilledAt" TIMESTAMP(3),
  CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrivacyRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrivacyRequest_storeId_requestId_key" ON "PrivacyRequest"("storeId", "requestId");
CREATE INDEX "PrivacyRequest_storeId_status_dueAt_idx" ON "PrivacyRequest"("storeId", "status", "dueAt");
