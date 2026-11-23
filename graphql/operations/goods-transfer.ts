/**
 * GraphQL operations for Goods Transfer — stock moving between branches.
 *
 * 21 operations cover the whole module, and every screen is built from that set. A
 * screen that appears to need one more is usually a screen drawn wrong rather than a
 * missing endpoint.
 *
 * Every operation is sent with the SELECTED channel token (the sidebar's channel
 * dropdown). That header is what makes a read branch-scoped — Madurai sees
 * Madurai's transfers because of it, not because of anything the screen decides.
 */

// ─── Reads ───────────────────────────────────────────────────────────

/**
 * The list, the report tabs and the search box are all this one read.
 *
 * `alerts` rides along with the answer: whatever the other branch has done since
 * `alertsAfterId` arrives with the list the screen was already fetching, so being
 * told costs no extra call and there is no read/unread state to keep anywhere.
 */
export const GOODS_TRANSFERS_QUERY = `
  query GetGoodsTransfers($status: TransferReportStatus, $input: ReportInput) {
    goodsTransfers(status: $status, input: $input) {
      totalItems
      summary {
        all
        requestDraft
        requested
        draft
        confirmed
        dispatched
        received
        damagePending
        damageDecided
        damageApproved
        damageRejected
        expiringSoon
      }
      items {
        id
        transferNumber
        state
        sourceChannelId
        destinationChannelId
        itemCount
        createdAt
        createdByName
        requestedAt
        requestedByName
        pdfAssetId
        damageRequests {
          state
        }
      }
      alerts {
        id
        type
        title
        refType
        refId
        transferNumber
        productName
        createdAt
      }
    }
  }
`;

/**
 * The detail screen — one read for the whole page.
 *
 * Lines, live destination stock, the history and any damage all come together, so
 * the screen never fans out into a second call. `pdfAsset` returns the printable
 * URL rather than only an id: an id cannot be opened.
 */
export const GOODS_TRANSFER_QUERY = `
  query GetGoodsTransfer($id: ID!) {
    goodsTransfer(id: $id) {
      id
      transferNumber
      state
      sourceChannelCode
      destinationChannelCode
      sourceChannelId
      destinationChannelId
      remarks
      driverName
      driverPhone
      vehicleNumber
      createdByName
      createdAt
      requestedAt
      requestedByName
      confirmedAt
      confirmedByName
      dispatchedAt
      dispatchedByName
      receivedAt
      receivedByName
      pdfAsset {
        id
        name
        source
        updatedAt
      }
      lines {
        id
        productId
        productVariantId
        productName
        sku
        isPooled
        poolUnit
        quantityPcs
        weightGrams
        poolQty
        currentStock
        damagedQty
      }
      audit(take: 20) {
        totalItems
        items {
          id
          createdAt
          action
          fromState
          toState
          userName
        }
      }
      damageRequests {
        id
        damageNumber
        state
        remarks
        createdAt
        createdByName
        approvedByName
        approvedAt
        lines {
          id
          lineId
          productName
          sku
          isPooled
          poolUnit
          damagedPcs
          damagedPoolQty
          receivedQtySnapshot
          damagePercent
          note
          photos {
            id
            name
            preview
            source
          }
        }
      }
    }
  }
`;

/**
 * Just the document, for the PDF button on a list row.
 *
 * The list carries only the asset ID, so the printable URL is fetched when the
 * button is pressed. Asking for every row's URL up front would fetch documents
 * nobody opens.
 */
export const TRANSFER_PDF_QUERY = `
  query GetTransferPdf($id: ID!) {
    goodsTransfer(id: $id) {
      id
      transferNumber
      pdfAsset {
        id
        name
        source
        updatedAt
      }
    }
  }
`;

/** The branch names, for the Ship-To picker. An existing project query. */
export const TRANSFER_CHANNELS_QUERY = `
  query GetTransferChannels {
    getChannelList {
      id
      code
      token
    }
  }
`;

/**
 * Products of the branch chosen in Ship-To.
 *
 * Disabled products come back too and are deliberately selectable: the picker is
 * admin-only, and a disabled line still travels and still prints — it simply posts
 * no stock when received. The screen labels them so nobody expects otherwise.
 */
/**
 * Local names straight from Vendure, for the branch the token belongs to.
 *
 * `customFields.localName` is the name a product carries in the catalogue itself —
 * on the product and again on each variant. Where it is filled it beats the Excel
 * master outright: no SKU to match, no family to guess at, and it moves with the
 * product when someone renames it.
 *
 * Read in one call after the catalogue loads and kept as two maps. Empty values are
 * ordinary — the master is still there for those.
 */
export const GOODS_TRANSFER_LOCAL_NAMES_QUERY = `
  query GoodsTransferLocalNames($take: Int!) {
    products(options: { take: $take }) {
      items {
        id
        customFields {
          localName
        }
        variants {
          id
          customFields {
            localName
          }
        }
      }
    }
  }
`;

export const SEARCH_TRANSFER_PRODUCTS_QUERY = `
  query SearchTransferProducts($destinationChannelId: ID!, $search: String, $take: Int) {
    searchTransferProducts(
      destinationChannelId: $destinationChannelId
      search: $search
      take: $take
    ) {
      productId
      productName
      isPooled
      poolUnit
      enabled
      variants {
        id
        sku
        name
        enabled
      }
    }
  }
`;

// ─── Transfer lifecycle ──────────────────────────────────────────────

/**
 * A product request — the other direction entirely.
 *
 * Every other call here is the SENDING branch moving its own goods. This one is
 * raised by the branch that will RECEIVE them, asking another branch to send. The
 * products are therefore validated against the asking branch's own catalogue: it is
 * listing what can arrive here, not what the other branch happens to stock.
 *
 * `send: false` keeps it private as a REQUEST_DRAFT, so the shelves can be walked and
 * the list corrected before the other branch ever sees it. `true` sends it at once.
 *
 * Nothing is reserved either way. A request is a question, and stock moves on receipt.
 */
export const CREATE_TRANSFER_REQUEST_MUTATION = `
  mutation CreateGoodsTransferRequest($input: CreateGoodsTransferRequestInput!) {
    createGoodsTransferRequest(input: $input) {
      id
      transferNumber
      state
    }
  }
`;

/**
 * Correct a request that has not been sent yet.
 *
 * The same input as updateGoodsTransfer and the same line semantics — but its own
 * mutation, because it carries the REQUEST permission (create OR receipt) rather than
 * Update. A Receiving Manager may raise a request and holds no Update permission;
 * routing the correction through updateGoodsTransfer left them able to write a draft
 * and unable to fix a quantity in it.
 */
export const UPDATE_TRANSFER_REQUEST_MUTATION = `
  mutation UpdateGoodsTransferRequest($input: UpdateGoodsTransferInput!) {
    updateGoodsTransferRequest(input: $input) {
      id
      state
      remarks
      driverName
      driverPhone
      vehicleNumber
      lines {
        id
        productName
        sku
        isPooled
        poolUnit
        quantityPcs
        weightGrams
        poolQty
        currentStock
        damagedQty
      }
    }
  }
`;

/** REQUEST_DRAFT → REQUESTED: the moment the branch being asked can see it. */
export const SEND_TRANSFER_REQUEST_MUTATION = `
  mutation SendGoodsTransferRequest($id: ID!) {
    sendGoodsTransferRequest(id: $id) {
      id
      transferNumber
      state
    }
  }
`;

export const CREATE_GOODS_TRANSFER_MUTATION = `
  mutation CreateGoodsTransfer($input: CreateGoodsTransferInput!) {
    createGoodsTransfer(input: $input) {
      id
      transferNumber
      state
      lines {
        id
        productName
        sku
        isPooled
        poolUnit
        quantityPcs
        weightGrams
        poolQty
      }
    }
  }
`;

/**
 * Editing, at DRAFT, CONFIRMED or DISPATCHED alike.
 *
 * The line semantics are the important part and are not obvious: a row carrying an
 * `id` changes THAT row's quantity, a row without one is added, and a row simply
 * not sent is left alone. Removal is explicit through `removeLineIds`. Sending only
 * the line you touched is therefore safe — the others do not vanish.
 */
export const UPDATE_GOODS_TRANSFER_MUTATION = `
  mutation UpdateGoodsTransfer($input: UpdateGoodsTransferInput!) {
    updateGoodsTransfer(input: $input) {
      id
      state
      remarks
      driverName
      driverPhone
      vehicleNumber
      lines {
        id
        productName
        sku
        isPooled
        poolUnit
        quantityPcs
        weightGrams
        poolQty
        currentStock
        damagedQty
      }
    }
  }
`;

export const DELETE_GOODS_TRANSFER_MUTATION = `
  mutation DeleteGoodsTransfer($id: ID!) {
    deleteGoodsTransfer(id: $id)
  }
`;

export const CONFIRM_GOODS_TRANSFER_MUTATION = `
  mutation ConfirmGoodsTransfer($id: ID!) {
    confirmGoodsTransfer(id: $id) {
      id
      state
      confirmedByName
      confirmedAt
      pdfAsset {
        id
        name
        source
        updatedAt
      }
    }
  }
`;

export const DISPATCH_GOODS_TRANSFER_MUTATION = `
  mutation DispatchGoodsTransfer($id: ID!) {
    dispatchGoodsTransfer(id: $id) {
      id
      state
      dispatchedByName
      dispatchedAt
    }
  }
`;

/**
 * The only action in the module that changes stock, and it changes it once.
 *
 * Destination branch only — the server checks the channel, not just the permission,
 * so the branch that sent the goods cannot accept them on the other's behalf.
 */
export const RECEIVE_GOODS_TRANSFER_MUTATION = `
  mutation ReceiveGoodsTransfer($id: ID!) {
    receiveGoodsTransfer(id: $id) {
      id
      state
      receivedByName
      receivedAt
      lines {
        id
        productName
        isPooled
        currentStock
      }
    }
  }
`;

// ─── Damage ──────────────────────────────────────────────────────────

/**
 * Raising damage — one claim covering every product found broken in a transfer.
 *
 * Photos travel as real files in the same multipart request; `photoIndexes` on each
 * line says which of them belong to it. A line whose damage reaches 5% of what was
 * received must carry at least one, and the server refuses the claim otherwise.
 *
 * This is the ONLY operation in the module that carries files, which is why it is
 * sent through /api/graphql-upload rather than the JSON proxy — see
 * services/goods-transfer.service.ts.
 */
export const CREATE_DAMAGE_REQUEST_MUTATION = `
  mutation CreateDamageRequest($input: CreateDamageRequestInput!, $photos: [Upload!]) {
    createDamageRequest(input: $input, photos: $photos) {
      id
      damageNumber
      state
      lines {
        id
        productName
        damagedPcs
        damagedPoolQty
        damagePercent
        photos {
          id
          name
          preview
        }
      }
    }
  }
`;

export const APPROVE_DAMAGE_REQUEST_MUTATION = `
  mutation ApproveDamageRequest($id: ID!) {
    approveDamageRequest(id: $id) {
      id
      damageNumber
      state
      approvedByName
      approvedAt
    }
  }
`;

export const REJECT_DAMAGE_REQUEST_MUTATION = `
  mutation RejectDamageRequest($id: ID!) {
    rejectDamageRequest(id: $id) {
      id
      damageNumber
      state
      approvedByName
      approvedAt
    }
  }
`;

// ─── Push subscription ───────────────────────────────────────────────
//
// Where the browser's push address is kept, so the server knows where to send.
//
// It lives on a custom field of the administrator record and travels through
// Vendure's OWN updateActiveAdministrator mutation — "the signed-in admin updates
// their own record" is exactly the shape of that sentence, so this module publishes
// no endpoint for it.
//
// These are DELIBERATELY separate from the operations in graphql/operations/auth.ts,
// which must not learn about this field. ACTIVE_ADMIN_QUERY there runs on every
// login and every session restore; the `gtPushSubscription` field is declared by the
// Goods Transfer plugin, so on a server without that plugin, adding it there would
// fail the query, fail restoreSession, and log the whole dashboard out — delivery
// partners included. Kept apart, a missing plugin costs nothing but push.

/**
 * The expiry screen — PRODUCTS this branch has been warned about.
 *
 * Not the transfer list with a filter on it: expiry belongs to something on a shelf,
 * and a list of transfers makes the reader open each one to find out which product
 * was meant. The transfer number comes along as context, not as the subject.
 *
 * Only rows with stock remaining come back, so this shrinks as things are sold rather
 * than growing forever.
 */
export const EXPIRING_PRODUCTS_QUERY = `
  query GoodsTransferExpiringProducts($input: ExpiringProductsInput) {
    expiringProducts(input: $input) {
      totalItems
      items {
        lineId
        productName
        sku
        isPooled
        poolUnit
        currentStock
        receivedAt
        expiresAt
        warnedAt
        transferId
        transferNumber
      }
    }
  }
`;

/**
 * Several of this branch's transfers on ONE sheet — the note a driver carries when
 * he is making every drop in one run.
 *
 * The PDF comes back as bytes rather than as an asset, because nothing stores it:
 * each transfer keeps its own permanent document, and this is a reprint of a chosen
 * set of them, rebuilt whenever it is asked for. There is therefore no id to fetch it
 * by later and nothing left behind in the asset store.
 *
 * Only confirmed transfers are included. A draft has no document today either, and a
 * load nobody has confirmed must not reach a driver.
 */
export const COMBINED_TRANSFER_DOCUMENT_QUERY = `
  query GoodsTransferCombinedDocument($input: CombinedTransferDocumentInput!) {
    combinedTransferDocument(input: $input) {
      filename
      content
      transferNumbers
      destinationChannelCodes
    }
  }
`;

/**
 * The same consignments as a flat list of lines, each carrying its LOCAL NAME.
 *
 * Unmerged on purpose — adding up the lines that share a local name is arithmetic,
 * and it happens here, next to the sheet that prints them.
 */
export const TRANSFER_LOADING_LIST_QUERY = `
  query GoodsTransferLoadingList($input: CombinedTransferDocumentInput!) {
    transferLoadingList(input: $input) {
      channelCode
      direction
      rows {
        branchCode
        transferNumber
        productName
        localName
        sku
        quantityPcs
        weightGrams
        poolUnit
      }
    }
  }
`;

export const SAVE_PUSH_SUBSCRIPTION_MUTATION = `
  mutation SaveGoodsTransferPushSubscription($input: UpdateActiveAdministratorInput!) {
    updateActiveAdministrator(input: $input) {
      id
    }
  }
`;

export const MY_PUSH_SUBSCRIPTION_QUERY = `
  query MyGoodsTransferPushSubscription {
    activeAdministrator {
      id
      customFields {
        gtPushSubscription
      }
    }
  }
`;
