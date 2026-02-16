# FindMyMarket 인터뷰 스크리닝 시스템 — 배포 가이드

## 아키텍처 구성도

```
참가자 브라우저                    Vercel (서버)                HubSpot
─────────────                  ─────────────              ──────────
                                                          
① LP 방문                                                 
② 카테고리 선택 (카드 UI)                                   
③ 이미지 업로드 (드래그앤드롭)                               
④ base64로 변환                                           
      │                                                   
      ▼                                                   
⑤ POST /api/validate-image ──►  ⑥ Claude Vision API 호출   
                                     │                     
                                     ▼                     
                                ⑦ 검증 JSON 반환           
      ◄──────────────────────────────┘                     
      │                                                    
      ▼                                                    
⑧ 결과 표시 (점수/통과/거부)                                
⑨ 폼 제출 ─────────────────────────────────────────►  ⑩ Contact 생성
                                ⑪ Contact Property 업데이트 ◄──┘
                                   (screening_status,            
                                    screening_score 등)         
                                                          ⑫ Workflow 실행
                                                             ├ approve → 일정잡기
                                                             ├ review  → 수동검토
                                                             └ reject  → 거절이메일
```

## 파일 구성

```
findmymarket-validation/
├── api/
│   └── validate-image.js      ← Vercel 서버리스 함수 (Claude Vision + HubSpot)
├── public/
│   └── preview.html           ← 전체 플로우 미리보기 (데모)
├── hubspot-lp-footer.html     ← ★ HubSpot LP에 삽입할 코드 ★
├── package.json               ← Vercel 프로젝트 의존성
├── vercel.json                ← Vercel 설정
└── README.md                  ← 이 파일
```

---

## 배포 순서

### STEP 1: Vercel API 배포

```bash
# 1. 프로젝트 폴더에서
cd findmymarket-validation

# 2. Vercel CLI 설치 (없는 경우)
npm i -g vercel

# 3. 배포
vercel

# 4. 환경변수 설정 (Vercel Dashboard → Settings → Environment Variables)
#    ANTHROPIC_API_KEY = sk-ant-...
#    HUBSPOT_API_KEY   = pat-na1-...
```

배포 후 URL 예시: `https://findmymarket-validation.vercel.app`
API 엔드포인트: `https://findmymarket-validation.vercel.app/api/validate-image`

### STEP 2: HubSpot Contact Properties 생성

Settings → CRM → Properties에서 다음 속성을 생성:

| Property Name       | Internal Name       | Field Type        |
|:---------------------|:---------------------|:-------------------|
| Interview Category   | interview_category   | Dropdown select    |
| Product Image        | product_image        | File               |
| Receipt Image        | receipt_image        | File               |
| Screening Status     | screening_status     | Single-line text   |
| Screening Score      | screening_score      | Number             |
| Screening Category   | screening_category   | Single-line text   |
| Screening Product    | screening_product    | Single-line text   |
| Screening Reasoning  | screening_reasoning  | Multi-line text    |
| Screening Date       | screening_date       | Single-line text   |
| Screening Red Flags  | screening_red_flags  | Single-line text   |

**interview_category** 드롭다운 옵션값:
- botox_filler
- laser_treatment
- supplements
- cosmetics
- dental
- eye_surgery

### STEP 3: HubSpot Form 생성

Marketing → Forms → Create form에서:
1. 이름(name), 이메일(email) 추가
2. interview_category 추가
3. product_image, receipt_image 추가
4. screening_status, screening_score 추가 (hidden 필드로)

### STEP 4: Landing Page에 코드 삽입

1. Content → Landing Pages → 페이지 선택 → Edit
2. Form 모듈을 페이지에 배치하고 Step 3의 폼을 선택
3. Settings → Advanced → **Footer HTML**
4. `hubspot-lp-footer.html` 전체 내용을 붙여넣기
5. 코드 내의 `API_ENDPOINT`를 Step 1의 Vercel URL로 교체:
   ```
   API_ENDPOINT: "https://findmymarket-validation.vercel.app/api/validate-image"
   ```
6. Publish / Update

### STEP 5: HubSpot Workflow 설정

Marketing → Automation → Workflows에서:

**Workflow 1: 검증 통과 (Approve)**
- Trigger: screening_status = "approve"
- Action: 인터뷰 일정 안내 이메일 발송
- Action: Deal 생성 (Interview pipeline)

**Workflow 2: 수동 검토 (Review)**
- Trigger: screening_status = "review"
- Action: 담당자에게 Task 생성 "이미지 수동 검토 필요"

**Workflow 3: 거절 (Reject)**
- Trigger: screening_status = "reject"
- Action: 거절 안내 이메일 발송

---

## API 테스트

```bash
curl -X POST https://findmymarket-validation.vercel.app/api/validate-image \
  -H "Content-Type: application/json" \
  -d '{
    "image_base64": "BASE64_ENCODED_IMAGE_HERE",
    "image_type": "image/jpeg",
    "category": "supplements",
    "contact_email": "test@example.com"
  }'
```

응답 예시:
```json
{
  "image_type": "product_photo",
  "product_or_procedure": "종근당 락토핏 골드",
  "brand_or_clinic": "종근당",
  "date_detected": null,
  "amount_detected": null,
  "category_match": true,
  "relevance_score": 0.92,
  "confidence": "high",
  "red_flags": [],
  "recommendation": "approve",
  "reasoning": "제품 패키지 전면 사진이 명확하며..."
}
```

---

## 비용 추정

| 항목 | 월간 비용 |
|:-----|:----------|
| Claude API (Sonnet, 500건) | ~$25 |
| Vercel Serverless (Hobby) | $0 |
| HubSpot (기존 플랜) | 기존 비용 |
| **합계** | **~$25/월** |

---

## CONFIG 커스터마이징

### 카테고리 이미지 URL 교체 (Footer HTML 내)
```javascript
CATEGORIES: {
  "botox_filler": {
    icon: "https://your-cdn.com/icons/botox.png",  // URL로 교체
    useImage: true,  // true로 변경
  },
}
```

### 카테고리 추가
1. Footer HTML의 `CATEGORIES`에 새 카테고리 추가
2. `api/validate-image.js`의 `CATEGORY_PROMPTS`에 검증 프롬프트 추가
3. HubSpot의 interview_category 드롭다운에 옵션 추가
