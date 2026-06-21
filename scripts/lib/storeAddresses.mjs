/** @sync src/lib/storeAddresses.ts */
export const STORE_VISIT_ADDRESS_BY_NAME = {
  恵比寿: `〒150-0022
東京都渋谷区恵比寿南1-14-9
アルティun 304

JR恵比寿駅 徒歩5分
日比谷線恵比寿駅 徒歩5分`,
  上野: `〒110-0016
東京都台東区台東4丁目31-5 オリオンビル4F

JR御徒町駅 徒歩3分
上野駅 徒歩7分`,
  桜木町: `神奈川県横浜市中区野毛町2-59-4
パストラル野毛マリヤ201

JR桜木町駅 徒歩4分`,
  新宿: `〒160-0023
東京都新宿区西新宿7-22-39
興亜第二マンション401

マイバスケットの裏の裏のマンションで入り口が赤いマンションになります。
入り口から入って通路奥エレベーターから4階までお上がりいただいて401号室です。`,
};

export function storeVisitAddressText(storeName) {
  return STORE_VISIT_ADDRESS_BY_NAME[String(storeName ?? "").trim()] ?? "";
}
