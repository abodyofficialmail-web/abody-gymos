export type AdsReportKind = "daily" | "weekly";

export type StoreAdsSlice = {
  store_id: string;
  store_name: string;
  line_channel_key: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  instagram_followers: number | null;
  instagram_followers_delta: number | null;
  line_followers: number | null;
  line_followers_delta: number | null;
  line_adds: number;
  line_unfollows: number;
  hour_counts: number[];
  weekday_counts: number[];
};

export type AdsMarketingReport = {
  kind: AdsReportKind;
  startYmd: string;
  endYmd: string;
  generatedAtYmd: string;
  stores: StoreAdsSlice[];
};

export type MetaStoreAccountConfig = {
  store_name: string;
  ad_account_id?: string;
  ig_user_id?: string;
  instagram_username?: string;
};
