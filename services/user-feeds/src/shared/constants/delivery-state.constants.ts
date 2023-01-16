export enum ArticleDeliveryRejectedCode {
  BadRequest = "user-feeds/bad-request",
  Forbidden = "user-feeds/forbidden",
}

export enum ArticleDeliveryErrorCode {
  Internal = "user-feeds/internal-error",
  NoChannelOrWebhook = "user-feeds/no-channel-or-webhook",
  ThirdPartyInternal = "user-feeds/third-party-internal",
}
