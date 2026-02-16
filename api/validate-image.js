// ================================================================
//  FindMyMarket — Image Validation API v2 (Vercel Serverless)
//  CommonJS 방식 (Vercel 호환)
// ================================================================

const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function buildValidationPrompt(productName, imageRole) {
  const roleDesc = imageRole === "receipt"
    ? "영수증, 결제 내역, 주문 내역 등 구매/시술 증빙 자료"
    : "제품 사진, 패키지, 시술 관련 사진 등";

  return `당신은 시장조사 인터뷰 참가자 스크리닝 전문가입니다.

참가자가 인터뷰 대상 제품/서비스로 "${productName}"을(를) 선택했습니다.
이 참가자가 업로드한 이미지(${roleDesc})를 분석하여,
"${productName}"과의 관련성을 검증해주세요.

분석 항목:
1. 이미지 유형 식별 (영수증/제품사진/주문내역/의료서류/기타/식별불가)
2. 이미지에서 식별되는 제품명, 브랜드명, 시술명, 기관명
3. 날짜, 금액 등 정보가 보이면 추출
4. "${productName}"과의 관련성 판단
5. 의심 요소 탐지:
   - 편집/합성 흔적
   - 인터넷에서 다운받은 스톡 이미지
   - 비현실적 금액
   - 해상도가 지나치게 낮은 이미지
   - 날짜가 비현실적 (미래, 10년 이상 과거)

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트, 마크다운, 설명 없이 순수 JSON만:

{
  "image_type": "receipt | product_photo | order_screenshot | medical_document | other | unidentifiable",
  "product_or_procedure": "이미지에서 식별된 제품명 또는 시술명 (없으면 null)",
  "brand_or_clinic": "브랜드명 또는 병원/기관명 (없으면 null)",
  "date_detected": "YYYY-MM-DD 또는 null",
  "amount_detected": "금액 문자열 또는 null",
  "category_match": true 또는 false,
  "relevance_score": 0.0에서 1.0 사이 숫자,
  "confidence": "high | medium | low",
  "red_flags": ["발견된 의심 요소 목록, 없으면 빈 배열"],
  "recommendation": "approve | review | reject",
  "reasoning": "한국어로 판단 근거 2-3문장"
}

점수 기준:
- 0.9~1.0: "${productName}"과 완벽히 일치
- 0.7~0.89: 강한 관련성
- 0.5~0.69: 부분적 관련
- 0.3~0.49: 약한 관련
- 0.0~0.29: 무관

recommendation 기준:
- approve: relevance_score >= 0.7 AND red_flags 없음
- review: relevance_score 0.5~0.69 OR red_flags 1개
- reject: relevance_score < 0.5 OR red_flags 2개 이상`;
}


module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Set CORS headers
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const {
      image_base64,
      image_type,
      image_role,
      product_name,
      contact_email,
      contact_id,
    } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: "image_base64 is required" });
    }
    if (!product_name) {
      return res.status(400).json({ error: "product_name is required" });
    }

    // Claude Vision API
    const anthropic = new Anthropic();
    const mediaType = image_type || "image/jpeg";
    const prompt = buildValidationPrompt(product_name, image_role || "product");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image_base64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    // Parse response
    const rawText = response.content
      .filter(function(block) { return block.type === "text"; })
      .map(function(block) { return block.text; })
      .join("");

    var validation;
    try {
      var jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      rawText.match(/(\{[\s\S]*\})/);
      validation = JSON.parse(jsonMatch ? jsonMatch[1] : rawText);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr);
      validation = {
        image_type: "unidentifiable",
        product_or_procedure: null,
        relevance_score: 0,
        confidence: "low",
        red_flags: ["AI 응답 파싱 실패"],
        recommendation: "review",
        reasoning: "수동 검토가 필요합니다.",
      };
    }

    var result = Object.assign({}, validation, {
      selected_product: product_name,
      image_role: image_role || "product",
      validated_at: new Date().toISOString(),
    });

    // HubSpot update
    if (process.env.HUBSPOT_API_KEY && (contact_id || contact_email)) {
      try {
        await updateHubSpotContact(contact_id, contact_email, result);
        result.hubspot_updated = true;
      } catch (hsErr) {
        console.error("HubSpot error:", hsErr);
        result.hubspot_updated = false;
      }
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Validation error:", error);
    return res.status(500).json({ error: "Validation failed", message: error.message });
  }
};


async function updateHubSpotContact(contactId, email, result) {
  var HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
  if (!HUBSPOT_API_KEY) return;

  var properties = {
    screening_status: result.recommendation,
    screening_score: String(result.relevance_score),
    screening_product: result.selected_product || "",
    screening_detected: result.product_or_procedure || "",
    screening_reasoning: result.reasoning || "",
    screening_date: result.validated_at,
    screening_red_flags: (result.red_flags || []).join("; "),
  };

  var headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + HUBSPOT_API_KEY,
  };

  if (contactId) {
    var r = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts/" + contactId,
      { method: "PATCH", headers: headers, body: JSON.stringify({ properties: properties }) }
    );
    if (!r.ok) throw new Error("HubSpot PATCH failed: " + r.status);
    return;
  }

  if (email) {
    var searchRes = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts/search",
      {
        method: "POST", headers: headers,
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        }),
      }
    );
    var data = await searchRes.json();
    if (data.results && data.results.length > 0) {
      await fetch(
        "https://api.hubapi.com/crm/v3/objects/contacts/" + data.results[0].id,
        { method: "PATCH", headers: headers, body: JSON.stringify({ properties: properties }) }
      );
    }
  }
}
