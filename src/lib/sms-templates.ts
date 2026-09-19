export type SmsTemplateLanguage = "vi" | "en";

/**
 * Tin nhắn mẫu "thiếu Tax INT" (bổ sung 2026-09-19) — dùng trong popup nhắn tin SMS theo hồ sơ
 * (`CaseSmsButton`), chèn sẵn vào ô soạn để người dùng sửa tự do trước khi gửi (không tự gửi).
 * Ghép theo NHIỀU năm đã chọn cùng lúc, mỗi năm có 1 số tiền INT riêng — dòng "thiếu khoản
 * tiền..." lặp lại cho từng năm, phần còn lại (chào hỏi/điều khoản phí) chỉ xuất hiện 1 lần.
 */
export function buildTaxIntShortfallSms(params: {
  taxpayerName: string;
  userName: string;
  agentName: string;
  years: string[];
  amounts: Record<string, string>;
  language: SmsTemplateLanguage;
}): string {
  const { taxpayerName, userName, agentName, years, amounts, language } = params;
  const sortedYears = [...years].sort();
  const yearsLabel = sortedYears.join(", ");
  const amountLines = sortedYears.map((year) => {
    const amount = amounts[year]?.trim() || "0";
    return language === "vi"
      ? `Sau khi đối chiếu với WIT của IRS thì năm ${year} mình còn thiếu khoản tiền $${amount} INT (tiền lãi nhận trong năm).`
      : `After reconciling with the IRS WIT, for year ${year} we found you're missing $${amount} in INT (interest income received that year).`;
  });

  if (language === "vi") {
    return [
      `Em chào anh chị ${taxpayerName}, em là ${userName} nhân viên xử lý hồ sơ của DirectFunder mà ${agentName} đã làm việc với anh chị trước đó về hồ sơ refund năm ${yearsLabel}.`,
      ...amountLines,
      `Bên em sẽ hỗ trợ bổ sung khoản còn thiếu này và khi IRS xử lý hồ sơ sẽ phát sinh thêm thuế phải đóng cho khoản tiền lãi đó.`,
      `Bên em vẫn sẽ tính lệ phí $85 và 20% dựa trên tổng số tiền hoàn thuế được IRS approved trước khi thực hiện bù vào tiền thuế phát sinh bổ sung INT.`,
      `Vui lòng say Yes nếu đồng ý.`,
    ].join("\n");
  }

  return [
    `Hi ${taxpayerName}, this is ${userName}, the case processor at DirectFunder who has taken over from ${agentName} on your tax refund case for year(s) ${yearsLabel}.`,
    ...amountLines,
    `We will help add this missing amount, and once the IRS processes it, additional tax will be owed on that interest income.`,
    `We will still charge our $85 + 20% fee based on the total refund amount approved by the IRS before offsetting it against the additional tax owed on the added INT.`,
    `Please reply Yes if you agree.`,
  ].join("\n");
}
