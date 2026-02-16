// ================================================================
//  FindMyMarket — Image Validation API (Vercel Serverless)
//  
//  엔드포인트: POST /api/validate-image
//  역할: 이미지 → Claude Vision 검증 → 결과 반환 + HubSpot 업데이트
//
//  배포: Vercel에 이 프로젝트를 배포하면 자동으로 엔드포인트 생성
//  환경변수 필요:
//    ANTHROPIC_API_KEY  — Claude API 키
//    HUBSPOT_API_KEY    — HubSpot Private App 토큰
// ================================================================

import Anthropic from "@anthropic-ai/sdk";

// ── CORS 헤더 ──
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",  // 프로덕션에서는 도메인 제한 권장
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── 카테고리별 검증 프롬프트 ──
const CATEGORY_PROMPTS = {
  "botox_filler": {
    name_ko: "보톡스/필러",
    prompt: `이 이미지를 분석하여 보톡스 또는 필러 시술과의 관련성을 검증해주세요.

확인 사항:
1. 이미지 유형: 영수증, 시술 확인서, 진료비 세부산출내역서, 병원 카드결제 내역, 앱 예약 내역 등
2. 시술 내용: 보톡스, 필러, 스킨보톡스, 리쥬란, 주름 시술 관련 키워드
3. 의료기관 정보: 피부과, 성형외과, 메디컬 스파 등
4. 날짜: 최근 6개월 이내인지
5. 의심 요소: 편집 흔적, 스톡 이미지, 비현실적 금액, 해상도 문제

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):`,
  },
  "laser_treatment": {
    name_ko: "레이저 시술",
    prompt: `이 이미지를 분석하여 레이저 피부 시술과의 관련성을 검증해주세요.

확인 사항:
1. 이미지 유형: 영수증, 시술 확인서, 진료비 내역, 카드결제 내역, 예약 내역 등
2. 시술 내용: 레이저토닝, 피코레이저, IPL, 프락셀, 레이저 리프팅 등
3. 의료기관 정보: 피부과, 레이저 클리닉 등
4. 날짜: 최근 6개월 이내인지
5. 의심 요소: 편집 흔적, 스톡 이미지, 비현실적 금액

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):`,
  },
  "supplements": {
    name_ko: "건강기능식품",
    prompt: `이 이미지를 분석하여 건강기능식품(유산균, 비타민, 오메가3, 콜라겐 등) 구매와의 관련성을 검증해주세요.

확인 사항:
1. 이미지 유형: 제품 사진, 구매 영수증, 온라인 주문 내역, 제품 패키지 등
2. 제품 정보: 브랜드명, 제품명, 성분, "건강기능식품" 인증 마크
3. 구매 채널: 올리브영, 쿠팡, 아이허브, 약국 등
4. 날짜: 최근 6개월 이내 구매인지
5. 의심 요소: 온라인에서 다운받은 이미지, 스톡사진, 해상도 문제

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):`,
  },
  "cosmetics": {
    name_ko: "화장품",
    prompt: `이 이미지를 분석하여 화장품(스킨케어, 메이크업, 선케어 등) 구매와의 관련성을 검증해주세요.

확인 사항:
1. 이미지 유형: 제품 사진, 구매 영수증, 온라인 주문 내역, 제품 패키지 등
2. 제품 정보: 브랜드명, 제품명, 제품 유형(세럼, 크림, 선크림 등)
3. 구매 채널: 올리브영, 시코르, 백화점, 온라인몰 등
4. 날짜: 최근 6개월 이내 구매인지
5. 의심 요소: 광고 이미지, 스톡사진, 해상도 문제

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):`,
  },
  "dental": {
    name_ko: "치과 시술",
    prompt: `이 이미지를 분석하여 치과 시술(임플란트, 교정, 미백, 라미네이트 등)과의 관련성을 검증해주세요.

확인 사항:
1. 이미지 유형: 영수증, 진료비 내역, 치료계획서, 카드결제 내역 등
2. 시술 내용: 임플란트, 교정, 미백, 라미네이트, 크라운 등
3. 의료기관: 치과의원, 치과병원
4. 날짜: 최근 12개월 이내인지
5. 의심 요소: 편집 흔적, 비현실적 금액

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):`,
  },
  "eye_surgery": {
    name_ko: "시력교정 (라식/라섹)",
    prompt: `이 이미지를 분석하여 시력교정 수술(라식, 라섹, 스마일라식, 렌즈삽입술 등)과의 관련성을 검증해주세요.

확인 사항:
1. 이미지 유형: 영수증, 수술 확인서, 진료비 내역, 예약 내역 등
2. 시술 내용: 라식, 라섹, 스마일라식, ICL, 렌즈삽입술 등
3. 의료기관: 안과의원, 안과병원
4. 날짜: 최근 12개월 이내인지
5. 의심 요소: 편집 흔적, 비현실적 금액

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):`,
  },
};

// ── JSON 응답 형식 (모든 카테고리 공통) ──
const JSON_SCHEMA = `
{
  "image_type": "receipt | product_photo | order_screenshot | medical_document | other | unidentifiable",
  "product_or_procedure": "식별된 제품명 또는 시술명 (없으면 null)",
  "brand_or_clinic": "브랜드명 또는 병원명 (없으면 null)",
  "date_detected": "YYYY-MM-DD 또는 null",
  "amount_detected": "금액 문자열 또는 null",
  "category_match": true | false,
  "relevance_score": 0.0 ~ 1.0,
  "confidence": "high | medium | low",
  "red_flags": ["발견된 의심 요소 목록"],
  "recommendation": "approve | review | reject",
  "reasoning": "한국어로 판단 근거 2-3문장"
}

점수 기준:
- 0.9~1.0: 완벽한 일치 (시술/제품 명확, 날짜/금액 확인 가능)
- 0.7~0.89: 강한 일치 (관련 시술/제품이지만 일부 정보 부족)
- 0.5~0.69: 부분 일치 (같은 분야이나 다른 시술/제품)
- 0.3~0.49: 약한 일치 (관련 있으나 카테고리 불일치)
- 0.0~0.29: 무관 (완전히 다른 카테고리)

recommendation 기준:
- approve: relevance_score >= 0.7 AND red_flags 없음
- review: relevance_score 0.5~0.69 OR red_flags 1개
- reject: relevance_score < 0.5 OR red_flags 2개 이상`;


export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).set(CORS_HEADERS).end();
  }

  // POST only
  if (req.method !== "POST") {
    return res.status(405).set(CORS_HEADERS).json({ error: "Method not allowed" });
  }

  try {
    const { image_base64, image_type, category, contact_email, contact_id } = req.body;

    // ── 입력 검증 ──
    if (!image_base64) {
      return res.status(400).set(CORS_HEADERS).json({ error: "image_base64 is required" });
    }
    if (!category || !CATEGORY_PROMPTS[category]) {
      return res.status(400).set(CORS_HEADERS).json({
        error: `Invalid category. Valid: ${Object.keys(CATEGORY_PROMPTS).join(", ")}`,
      });
    }

    // ── Claude Vision API 호출 ──
    const anthropic = new Anthropic();

    const categoryConfig = CATEGORY_PROMPTS[category];
    const mediaType = image_type || "image/jpeg";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: image_base64,
              },
            },
            {
              type: "text",
              text: `${categoryConfig.prompt}\n\n${JSON_SCHEMA}`,
            },
          ],
        },
      ],
    });

    // ── Claude 응답 파싱 ──
    const rawText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    let validation;
    try {
      // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || 
                         rawText.match(/(\{[\s\S]*\})/);
      validation = JSON.parse(jsonMatch ? jsonMatch[1] : rawText);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw:", rawText);
      validation = {
        image_type: "unidentifiable",
        product_or_procedure: null,
        relevance_score: 0,
        confidence: "low",
        red_flags: ["AI 응답 파싱 실패"],
        recommendation: "review",
        reasoning: "이미지 분석 결과를 처리하는 중 오류가 발생했습니다. 수동 검토가 필요합니다.",
      };
    }

    // ── 검증 결과에 메타 정보 추가 ──
    const result = {
      ...validation,
      category: category,
      category_name_ko: categoryConfig.name_ko,
      validated_at: new Date().toISOString(),
      model_used: "claude-sonnet-4-5-20250929",
    };

    // ── HubSpot Contact 업데이트 (contact_id 또는 email이 있는 경우) ──
    if (process.env.HUBSPOT_API_KEY && (contact_id || contact_email)) {
      try {
        await updateHubSpotContact(contact_id, contact_email, result);
        result.hubspot_updated = true;
      } catch (hsErr) {
        console.error("HubSpot update error:", hsErr);
        result.hubspot_updated = false;
        result.hubspot_error = hsErr.message;
      }
    }

    return res.status(200).set(CORS_HEADERS).json(result);

  } catch (error) {
    console.error("Validation error:", error);
    return res.status(500).set(CORS_HEADERS).json({
      error: "Validation failed",
      message: error.message,
    });
  }
}


// ── HubSpot Contact Property 업데이트 ──
async function updateHubSpotContact(contactId, email, validationResult) {
  const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
  if (!HUBSPOT_API_KEY) return;

  const properties = {
    screening_status: validationResult.recommendation,  // approve / review / reject
    screening_score: String(validationResult.relevance_score),
    screening_category: validationResult.category,
    screening_product: validationResult.product_or_procedure || "",
    screening_reasoning: validationResult.reasoning || "",
    screening_date: validationResult.validated_at,
    screening_red_flags: (validationResult.red_flags || []).join("; "),
  };

  // Contact ID로 업데이트
  if (contactId) {
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${HUBSPOT_API_KEY}`,
        },
        body: JSON.stringify({ properties }),
      }
    );
    if (!res.ok) throw new Error(`HubSpot PATCH failed: ${res.status}`);
    return await res.json();
  }

  // Email로 검색 후 업데이트
  if (email) {
    const searchRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${HUBSPOT_API_KEY}`,
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: "email", operator: "EQ", value: email }],
          }],
        }),
      }
    );
    const searchData = await searchRes.json();
    if (searchData.results && searchData.results.length > 0) {
      const id = searchData.results[0].id;
      const updateRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${HUBSPOT_API_KEY}`,
          },
          body: JSON.stringify({ properties }),
        }
      );
      if (!updateRes.ok) throw new Error(`HubSpot PATCH failed: ${updateRes.status}`);
      return await updateRes.json();
    }
  }
}
