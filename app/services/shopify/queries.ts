/**
 * Admin GraphQL documents used by the sync layer. Kept as plain strings so
 * they can be validated with the Shopify AI Toolkit and used with both the
 * regular GraphQL client and Bulk Operations.
 */

export const ORDER_FIELDS = /* GraphQL */ `
  fragment ProfitPilotOrder on Order {
    id
    name
    createdAt
    processedAt
    updatedAt
    cancelledAt
    closedAt
    test
    currencyCode
    taxesIncluded
    displayFinancialStatus
    displayFulfillmentStatus
    sourceName
    customer { id }
    shippingAddress { countryCodeV2 }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    totalDiscountsSet { shopMoney { amount currencyCode } }
    totalShippingPriceSet { shopMoney { amount currencyCode } }
    totalTaxSet { shopMoney { amount currencyCode } }
    totalTipReceivedSet { shopMoney { amount currencyCode } }
    totalPriceSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    currentTotalDutiesSet { shopMoney { amount currencyCode } }
    lineItems(first: 100) {
      nodes {
        id
        title
        sku
        quantity
        currentQuantity
        requiresShipping
        isGiftCard
        product { id }
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        totalDiscountSet { shopMoney { amount currencyCode } }
        taxLines { priceSet { shopMoney { amount currencyCode } } }
      }
    }
    refunds {
      id
      createdAt
      totalRefundedSet { shopMoney { amount currencyCode } }
      refundLineItems(first: 100) {
        nodes {
          quantity
          restockType
          lineItem { id }
          subtotalSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
        }
      }
      refundShippingLines(first: 20) {
        nodes { subtotalAmountSet { shopMoney { amount currencyCode } } }
      }
    }
    transactions(first: 50) {
      id
      kind
      status
      gateway
      processedAt
      test
      amountSet { shopMoney { amount currencyCode } }
      fees { amount { amount currencyCode } }
    }
  }
`;

export const ORDERS_PAGE_QUERY = /* GraphQL */ `
  ${ORDER_FIELDS}
  query ProfitPilotOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ...ProfitPilotOrder }
    }
  }
`;

export const ORDER_BY_ID_QUERY = /* GraphQL */ `
  ${ORDER_FIELDS}
  query ProfitPilotOrder($id: ID!) {
    order(id: $id) { ...ProfitPilotOrder }
  }
`;

export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query ProfitPilotProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        updatedAt
        featuredMedia { preview { image { url } } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            updatedAt
            inventoryItem {
              id
              unitCost { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

export const PRODUCT_BY_ID_QUERY = /* GraphQL */ `
  query ProfitPilotProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      updatedAt
      featuredMedia { preview { image { url } } }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          barcode
          price
          compareAtPrice
          updatedAt
          inventoryItem { id unitCost { amount currencyCode } }
        }
      }
    }
  }
`;

export const SHOP_QUERY = /* GraphQL */ `
  query ProfitPilotShop {
    shop {
      id
      name
      email
      myshopifyDomain
      primaryDomain { host }
      currencyCode
      ianaTimezone
      taxesIncluded
      plan { partnerDevelopment shopifyPlus }
    }
  }
`;

export const ORDERS_COUNT_QUERY = /* GraphQL */ `
  query ProfitPilotOrdersCount($query: String) {
    ordersCount(query: $query, limit: null) { count precision }
  }
`;

export const BULK_ORDERS_QUERY = /* GraphQL */ `
  ${ORDER_FIELDS}
  query ProfitPilotBulkOrders($query: String) {
    orders(query: $query) {
      edges { node { ...ProfitPilotOrder } }
    }
  }
`;

export const BULK_RUN_MUTATION = /* GraphQL */ `
  mutation ProfitPilotBulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

export const BULK_STATUS_QUERY = /* GraphQL */ `
  query ProfitPilotBulkStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        url
        partialDataUrl
      }
    }
  }
`;

export const CURRENT_BULK_QUERY = /* GraphQL */ `
  query ProfitPilotCurrentBulk {
    currentBulkOperation(type: QUERY) { id status errorCode url objectCount }
  }
`;

export const WEBHOOK_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query ProfitPilotWebhooks {
    webhookSubscriptions(first: 50) {
      nodes { id topic uri }
    }
  }
`;
