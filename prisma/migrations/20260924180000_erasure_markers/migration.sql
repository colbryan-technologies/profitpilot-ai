CREATE TABLE "ErasureMarker" (
  "storeId" TEXT NOT NULL,
  "subjectHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErasureMarker_pkey" PRIMARY KEY ("storeId", "subjectHash"),
  CONSTRAINT "ErasureMarker_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
