import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

def build_presentation(output_path="SIDPA_Executive_Presentation.pptx"):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Institutional Palette
    DARK_BG = RGBColor(11, 19, 43)        # Midnight Navy
    DARK_CARD = RGBColor(19, 31, 60)      # Deep Navy Card
    LIGHT_BG = RGBColor(248, 250, 252)    # Slate 50
    CARD_BG = RGBColor(255, 255, 255)     # Pure White
    CARD_BORDER = RGBColor(226, 232, 240) # Slate 200
    GOLD = RGBColor(217, 119, 6)          # Amber 600
    GOLD_LIGHT = RGBColor(245, 158, 11)   # Amber 500
    BLUE_ACCENT = RGBColor(37, 99, 235)   # Royal Cobalt 600
    GREEN_ACCENT = RGBColor(5, 150, 105)  # Emerald 600
    TEXT_DARK = RGBColor(15, 23, 42)      # Slate 900
    TEXT_MUTED = RGBColor(100, 116, 139)  # Slate 500
    TEXT_LIGHT = RGBColor(241, 245, 249)  # Slate 100
    TEXT_LIGHT_MUTED = RGBColor(148, 163, 184) # Slate 400

    def add_bg(slide, color):
        shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        shape.fill.solid()
        shape.fill.fore_color.rgb = color
        shape.line.fill.background()
        return shape

    def add_header(slide, kicker, title, is_dark=False):
        box = slide.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.733), Inches(1.1))
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        # Kicker
        p_kicker = tf.paragraphs[0]
        p_kicker.text = kicker.upper()
        p_kicker.font.size = Pt(11)
        p_kicker.font.bold = True
        p_kicker.font.color.rgb = GOLD_LIGHT if is_dark else GOLD

        # Title
        p_title = tf.add_paragraph()
        p_title.text = title
        p_title.font.size = Pt(24)
        p_title.font.bold = True
        p_title.font.color.rgb = TEXT_LIGHT if is_dark else TEXT_DARK
        p_title.space_before = Pt(4)

    # -------------------------------------------------------------------------
    # SLIDE 1: Title Slide (Dark Theme)
    # -------------------------------------------------------------------------
    slide1 = prs.slides.add_slide(blank_layout)
    add_bg(slide1, DARK_BG)

    # Decorative Accent Bar
    accent_bar = slide1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.6), Inches(0.08), Inches(3.6))
    accent_bar.fill.solid()
    accent_bar.fill.fore_color.rgb = GOLD
    accent_bar.line.fill.background()

    # Title & Subtitle Frame
    tbox = slide1.shapes.add_textbox(Inches(1.2), Inches(1.5), Inches(11.2), Inches(3.8))
    tf1 = tbox.text_frame
    tf1.word_wrap = True

    p0 = tf1.paragraphs[0]
    p0.text = "SMA CHARTER v1.0 • OPEN STANDARDS RELEASE"
    p0.font.size = Pt(13)
    p0.font.bold = True
    p0.font.color.rgb = GOLD_LIGHT

    p1 = tf1.add_paragraph()
    p1.text = "SIDPA: Intelligence Capital\nMarket Infrastructure"
    p1.font.size = Pt(42)
    p1.font.bold = True
    p1.font.color.rgb = TEXT_LIGHT
    p1.space_before = Pt(12)

    p2 = tf1.add_paragraph()
    p2.text = "The Measurement Authority, Attestation Network, and Settlement Infrastructure for Intelligence Capital."
    p2.font.size = Pt(19)
    p2.font.color.rgb = TEXT_LIGHT_MUTED
    p2.space_before = Pt(16)

    # Bottom Metadata Cards
    foot_box = slide1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.8), Inches(11.733), Inches(0.95))
    foot_box.fill.solid()
    foot_box.fill.fore_color.rgb = DARK_CARD
    foot_box.line.color.rgb = RGBColor(30, 41, 59)
    ftf = foot_box.text_frame
    ftf.vertical_anchor = MSO_ANCHOR.MIDDLE
    ftf.margin_left = Inches(0.3)
    p_meta = ftf.paragraphs[0]
    p_meta.text = "Governing Body: SIDPA Measurement Authority (SMA) Board of Governors   |   Doc Ref: SMA-CHART-2026-v1.0   |   Classification: Public Standards"
    p_meta.font.size = Pt(12)
    p_meta.font.color.rgb = TEXT_LIGHT_MUTED

    # -------------------------------------------------------------------------
    # SLIDE 2: The Logical Chain (Light Theme)
    # -------------------------------------------------------------------------
    slide2 = prs.slides.add_slide(blank_layout)
    add_bg(slide2, LIGHT_BG)
    add_header(slide2, "The Core Institutional Thesis", "The Logical Chain: Transforming Compute to Capital")

    steps = [
        ("01", "Compute is\nInfrastructure", "Silicon & Energy", "Raw GPU-hours, electricity, data centers, and cluster CapEx. Currently accounted strictly as operational cost sinks."),
        ("02", "Intelligence\nis Output", "Cognitive Work", "Compute processes tokens, reasoning chains, and task completions. Unmeasured output creates the accounting gap."),
        ("03", "Output is\nAccounted For", "Standardized IDU", "IDU standardization, hardware TEE attestation, and three-ledger filtering extract compute waste from net delivery."),
        ("04", "Audited Assets\nare Financed", "GAAP Standards", "Verified delivery manifests create audited, GAAP-compliant intangible assets recognizable on balance sheets."),
        ("05", "An Asset Class\nEmerges", "Market Liquidity", "Standardized units unlock forward capacity clearing, secondary trading, structured debt, and insurance underwriting.")
    ]

    card_w = Inches(2.18)
    card_gap = Inches(0.2)
    left_start = Inches(0.8)

    for i, (num, title, badge, desc) in enumerate(steps):
        cx = left_start + i * (card_w + card_gap)
        card = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, Inches(1.8), card_w, Inches(5.0))
        card.fill.solid()
        card.fill.fore_color.rgb = CARD_BG
        card.line.color.rgb = CARD_BORDER

        ctf = card.text_frame
        ctf.word_wrap = True
        ctf.margin_left = ctf.margin_right = ctf.margin_top = ctf.margin_bottom = Inches(0.22)

        # Number Badge
        pn = ctf.paragraphs[0]
        pn.text = num
        pn.font.size = Pt(28)
        pn.font.bold = True
        pn.font.color.rgb = BLUE_ACCENT

        # Title
        pt = ctf.add_paragraph()
        pt.text = title
        pt.font.size = Pt(16)
        pt.font.bold = True
        pt.font.color.rgb = TEXT_DARK
        pt.space_before = Pt(8)

        # Badge
        pb = ctf.add_paragraph()
        pb.text = f"[{badge}]"
        pb.font.size = Pt(11)
        pb.font.bold = True
        pb.font.color.rgb = GOLD
        pb.space_before = Pt(6)

        # Desc
        pd = ctf.add_paragraph()
        pd.text = desc
        pd.font.size = Pt(12)
        pd.font.color.rgb = TEXT_MUTED
        pd.space_before = Pt(12)

    # -------------------------------------------------------------------------
    # SLIDE 3: The Intelligence Accounting Gap (Light Theme)
    # -------------------------------------------------------------------------
    slide3 = prs.slides.add_slide(blank_layout)
    add_bg(slide3, LIGHT_BG)
    add_header(slide3, "Enterprise & Financial Reality", "The Intelligence Accounting Gap: Inputs vs. Economic Value")

    # Left Column: Inputs Tracked Today
    left_card = slide3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.7), Inches(5.0))
    left_card.fill.solid()
    left_card.fill.fore_color.rgb = CARD_BG
    left_card.line.color.rgb = RGBColor(203, 213, 225)
    ltf = left_card.text_frame
    ltf.word_wrap = True
    ltf.margin_left = ltf.margin_right = ltf.margin_top = Inches(0.35)

    lp1 = ltf.paragraphs[0]
    lp1.text = "WHAT ENTERPRISES TRACK TODAY"
    lp1.font.size = Pt(12)
    lp1.font.bold = True
    lp1.font.color.rgb = TEXT_MUTED

    lp2 = ltf.add_paragraph()
    lp2.text = "Infrastructure Input Telemetry"
    lp2.font.size = Pt(20)
    lp2.font.bold = True
    lp2.font.color.rgb = TEXT_DARK
    lp2.space_before = Pt(4)

    inputs = [
        "Unverified cloud invoices and gross GPU cluster lease rates (per instance-hour)",
        "Gross unweighted token counts (input / output volume)",
        "Hardware cluster utilization % (silicon active vs. idle time)",
        "Network-level availability SLAs (e.g. 99.9% port uptime)"
    ]
    for inp in inputs:
        p = ltf.add_paragraph()
        p.text = f"•  {inp}"
        p.font.size = Pt(13)
        p.font.color.rgb = TEXT_DARK
        p.space_before = Pt(12)

    l_bot = ltf.add_paragraph()
    l_bot.text = "CORE DEFECT: Treats intelligence as an unmeasured, consumable operational expense sink without visibility into output productivity."
    l_bot.font.size = Pt(11)
    l_bot.font.bold = True
    l_bot.font.color.rgb = RGBColor(185, 28, 28) # Red 700
    l_bot.space_before = Pt(20)

    # Right Column: What Boards Cannot Answer
    right_card = slide3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(5.0))
    right_card.fill.solid()
    right_card.fill.fore_color.rgb = CARD_BG
    right_card.line.color.rgb = BLUE_ACCENT
    rtf = right_card.text_frame
    rtf.word_wrap = True
    rtf.margin_left = rtf.margin_right = rtf.margin_top = Inches(0.35)

    rp1 = rtf.paragraphs[0]
    rp1.text = "WHAT BOARDS & CFOS CANNOT ANSWER"
    rp1.font.size = Pt(12)
    rp1.font.bold = True
    rp1.font.color.rgb = BLUE_ACCENT

    rp2 = rtf.add_paragraph()
    rp2.text = "The Missing Economic Accountability"
    rp2.font.size = Pt(20)
    rp2.font.bold = True
    rp2.font.color.rgb = TEXT_DARK
    rp2.space_before = Pt(4)

    outputs = [
        "Net Productive Output: How many delivered tokens represented actual task resolution vs. retry loops?",
        "Compute Waste: What financial cost was incurred by context overflow, speculative loss, and hallucinations?",
        "True Capital Efficiency: What is the verifiable Return on Invested Capital (ROIC) per model deployment?",
        "Balance Sheet Capitalization: How can enterprise AI IP be capitalized as an audited asset under GAAP/IFRS?"
    ]
    for outp in outputs:
        p = rtf.add_paragraph()
        p.text = f"•  {outp}"
        p.font.size = Pt(13)
        p.font.color.rgb = TEXT_DARK
        p.space_before = Pt(12)

    r_bot = rtf.add_paragraph()
    r_bot.text = "SIDPA SOLUTION: Delivers cryptographic attestation (SSI) and Intelligence GAAP (SIA) to solve both sides of the balance sheet."
    r_bot.font.size = Pt(11)
    r_bot.font.bold = True
    r_bot.font.color.rgb = GREEN_ACCENT
    r_bot.space_before = Pt(20)

    # -------------------------------------------------------------------------
    # SLIDE 4: Market Evolution (Historical Parallels) (Light Theme)
    # -------------------------------------------------------------------------
    slide4 = prs.slides.add_slide(blank_layout)
    add_bg(slide4, LIGHT_BG)
    add_header(slide4, "Institutional Precedents", "Market Evolution: Measurement Precedes Monetization")

    revolutions = [
        ("Commercial Revolution", "14th - 19th Century", "Double-Entry Bookkeeping", "Separation of ownership and operational agency. Enabled commercial enterprise, joint-stock corporations, equity formation, and corporate debt markets."),
        ("Electrical Revolution", "Early 20th Century", "The Kilowatt-Hour (kWh)", "Universal unit of physical power consumption. Unlocked utility monopolies, interconnected regional grids, wholesale power markets, and project finance."),
        ("Global Trade Revolution", "1950s - 1970s", "The Standard ISO Container", "Standardized intermodal shipping units. Reduced maritime cargo handling costs by over 90%, enabling globalized supply chains and freight derivatives."),
        ("The Intelligence Era", "2026 and Beyond", "SIDPA Intelligence GAAP & IDU", "Universal measurement of cognitive production & delivery net of waste. Unlocks balance-sheet capitalization, capacity clearing, and intelligence asset liquidity.")
    ]

    card_w4 = Inches(2.78)
    gap4 = Inches(0.2)
    left4 = Inches(0.8)

    for i, (era, dates, tech, impact) in enumerate(revolutions):
        cx = left4 + i * (card_w4 + gap4)
        c = slide4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, Inches(1.8), card_w4, Inches(5.0))
        c.fill.solid()
        c.fill.fore_color.rgb = CARD_BG
        c.line.color.rgb = CARD_BORDER

        tf = c.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.25)

        p1 = tf.paragraphs[0]
        p1.text = dates.upper()
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = GOLD

        p2 = tf.add_paragraph()
        p2.text = era
        p2.font.size = Pt(17)
        p2.font.bold = True
        p2.font.color.rgb = TEXT_DARK
        p2.space_before = Pt(6)

        p3 = tf.add_paragraph()
        p3.text = f"BREAKTHROUGH:\n{tech}"
        p3.font.size = Pt(13)
        p3.font.bold = True
        p3.font.color.rgb = BLUE_ACCENT
        p3.space_before = Pt(12)

        p4 = tf.add_paragraph()
        p4.text = f"MARKET IMPACT:\n{impact}"
        p4.font.size = Pt(11)
        p4.font.color.rgb = TEXT_MUTED
        p4.space_before = Pt(14)

    # -------------------------------------------------------------------------
    # SLIDE 5: The Four Pillars Architecture (Light Theme)
    # -------------------------------------------------------------------------
    slide5 = prs.slides.add_slide(blank_layout)
    add_bg(slide5, LIGHT_BG)
    add_header(slide5, "System Taxonomy", "The Four Pillars of the SIDPA Architecture")

    pillars = [
        ("SCIP", "Capacity (Infrastructure)", "What could be produced?", "Compute CapEx, silicon lifecycle economics, regional energy/cooling price indices, and normalized Intelligence Production Capacity (IPC) across heterogeneous GPU architectures."),
        ("SSI", "Trust & Attestation", "Is the output verified & secure?", "Hardware TEE enclaves (AMD SEV-SNP, Intel TDX), cryptographic model weight provenance, HSM enclave signatures, and sovereign regulatory compliance verification."),
        ("SIA", "Accounting (Operations)", "What was actually delivered?", "Intelligence GAAP auditing, the three-ledger model, reconciliation of theoretical IPC against delivered IDU, and programmatic waste extraction."),
        ("SII", "Value & Finance", "What economic value was created?", "Standardized spot and forward benchmark indices, corporate transfer pricing, capital yield calculations, and financial clearing rails.")
    ]

    for idx, (code, name, question, desc) in enumerate(pillars):
        row = idx // 2
        col = idx % 2
        px = Inches(0.8) + col * Inches(6.0)
        py = Inches(1.8) + row * Inches(2.55)

        box = slide5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, px, py, Inches(5.7), Inches(2.35))
        box.fill.solid()
        box.fill.fore_color.rgb = CARD_BG
        box.line.color.rgb = CARD_BORDER

        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.25)

        p1 = tf.paragraphs[0]
        p1.text = f"{code}  |  {name}"
        p1.font.size = Pt(16)
        p1.font.bold = True
        p1.font.color.rgb = BLUE_ACCENT

        p2 = tf.add_paragraph()
        p2.text = f'Core Question: "{question}"'
        p2.font.size = Pt(12)
        p2.font.bold = True
        p2.font.color.rgb = GOLD
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = desc
        p3.font.size = Pt(11)
        p3.font.color.rgb = TEXT_DARK
        p3.space_before = Pt(8)

    # -------------------------------------------------------------------------
    # SLIDE 6: SIA Three-Ledger Accounting Model (Light Theme)
    # -------------------------------------------------------------------------
    slide6 = prs.slides.add_slide(blank_layout)
    add_bg(slide6, LIGHT_BG)
    add_header(slide6, "Intelligence GAAP Standard", "SIA Three-Ledger Accounting Model")

    ledgers = [
        ("LEDGER 1", "Capacity Ledger (IPC)", "Intelligence Production Capacity", "Measures theoretical available cognitive production across clusters and AI factories.\n\n• Unit of Account: IPC (Continuous cognitive capacity normalized to standard FP16/FP8 benchmarks).\n• Analog: Megawatts (MW) installed capacity in power generation.\n• Function: Capital planning, cluster reservation, and depreciation schedules."),
        ("LEDGER 2", "Delivery Ledger (IDU)", "Intelligence Delivery Unit", "Records SLA-verified, cryptographically attested cognitive delivery net of compute waste.\n\n• Unit of Account: IDU (Task-verified output tokens delivered within guaranteed latency bounds).\n• Analog: Megawatt-Hours (MWh) delivered to commercial consumers.\n• Function: Enterprise OpEx billing, consumption accounting, and waste extraction."),
        ("LEDGER 3", "Value Ledger (Yield)", "Intelligence Yield & Valuation", "Computes the verified economic return and delivered cognitive value per unit of capital cost.\n\n• Metric: Intelligence Yield Ratio.\n• Analog: Spark Spread / Heat Rate in energy financial markets.\n• Function: ROIC determination, capacity arbitrage, asset valuation, and treasury management.")
    ]

    card_w6 = Inches(3.73)
    gap6 = Inches(0.27)
    left6 = Inches(0.8)

    for i, (badge, title, focus, content) in enumerate(ledgers):
        cx = left6 + i * (card_w6 + gap6)
        c = slide6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, Inches(1.8), card_w6, Inches(5.0))
        c.fill.solid()
        c.fill.fore_color.rgb = CARD_BG
        c.line.color.rgb = CARD_BORDER

        tf = c.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.3)

        p1 = tf.paragraphs[0]
        p1.text = badge
        p1.font.size = Pt(11)
        p1.font.bold = True
        p1.font.color.rgb = GOLD

        p2 = tf.add_paragraph()
        p2.text = title
        p2.font.size = Pt(17)
        p2.font.bold = True
        p2.font.color.rgb = TEXT_DARK
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = focus
        p3.font.size = Pt(12)
        p3.font.color.rgb = BLUE_ACCENT
        p3.space_before = Pt(4)

        p4 = tf.add_paragraph()
        p4.text = content
        p4.font.size = Pt(12)
        p4.font.color.rgb = TEXT_DARK
        p4.space_before = Pt(16)

    # -------------------------------------------------------------------------
    # SLIDE 7: Economic Model & Yield Formulas (Light Theme)
    # -------------------------------------------------------------------------
    slide7 = prs.slides.add_slide(blank_layout)
    add_bg(slide7, LIGHT_BG)
    add_header(slide7, "Financial Formulations", "Economic Model & Institutional Yield Formulas")

    formulas = [
        ("01", "Intelligence Yield Formula", "Intelligence Yield = [ IDU Delivered ] / [ SCIP Cost + Energy + Silicon Depreciation ]",
         "The baseline standard for computing capital efficiency across AI infrastructure. Measures the volume of attested cognitive output produced per unit of amortized input expenditure."),
        ("02", "Net Delivery Rate (NDR)", "NDR = ( Gross Output Tokens - Waste Tokens ) / Gross Tokens × SLA Compliance Factor",
         "Extracts compute waste—including agent retry loops, prompt overflow, speculative decode drops, and hallucination branches—ensuring enterprises pay only for productive output."),
        ("03", "Enterprise AI ROI Formula", "ROI_AI = ( Δ Verified Economic Value - Total Intelligence Cost ) / Total Intelligence Cost",
         "Connects operational workflow acceleration directly to balance sheet profitability, providing CFOs with audited figures for internal capital allocation and external stakeholder reporting.")
    ]

    for i, (num, name, eq, desc) in enumerate(formulas):
        fy = Inches(1.8) + i * Inches(1.68)
        fcard = slide7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), fy, Inches(11.733), Inches(1.52))
        fcard.fill.solid()
        fcard.fill.fore_color.rgb = CARD_BG
        fcard.line.color.rgb = CARD_BORDER

        tf = fcard.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.25)

        p1 = tf.paragraphs[0]
        p1.text = f"{num}  |  {name.upper()}"
        p1.font.size = Pt(11)
        p1.font.bold = True
        p1.font.color.rgb = GOLD

        p2 = tf.add_paragraph()
        p2.text = eq
        p2.font.size = Pt(14)
        p2.font.bold = True
        p2.font.color.rgb = BLUE_ACCENT
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = desc
        p3.font.size = Pt(11)
        p3.font.color.rgb = TEXT_DARK
        p3.space_before = Pt(4)

    # -------------------------------------------------------------------------
    # SLIDE 8: Market Opportunity & Scaling (Light Theme)
    # -------------------------------------------------------------------------
    slide8 = prs.slides.add_slide(blank_layout)
    add_bg(slide8, LIGHT_BG)
    add_header(slide8, "Exponential Workload Scaling", "Market Opportunity: Structural Capture of Exponential Compute Expansion")

    market_metrics = [
        ("TIER 1 | GLOBAL HORIZON", "Universal Compute Surface", "Total Addressable Workload Scope",
         "Every unit of global AI training, inference, and autonomous agent swarms. As compute compounds exponentially across clusters, clouds, and sovereign silicon, SIDPA establishes the standard accounting layer across all productive intelligence."),
        ("TIER 2 | MISSION-CRITICAL", "High-Assurance Workloads", "Serviceable Enterprise Demand",
         "Heavily audited enterprise domains—banking, life sciences, healthcare, defense, and public infrastructure—where unverified inferences, untracked waste, and hallucinations create unacceptable regulatory and fiduciary liabilities."),
        ("TIER 3 | CONSORTIUM ANCHOR", "Consortium Clearing Network", "Initial Settlement Rails",
         "Leading enterprise consortia, sovereign datacenter operators, and institutional clearinghouse partners adopting the SMA open standards to anchor the de facto intelligence settlement network and multi-cloud clearing baseline.")
    ]

    card_w8 = Inches(3.73)
    gap8 = Inches(0.27)
    left8 = Inches(0.8)

    for i, (badge, headline, subtitle, desc) in enumerate(market_metrics):
        cx = left8 + i * (card_w8 + gap8)
        c = slide8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, Inches(1.8), card_w8, Inches(3.2))
        c.fill.solid()
        c.fill.fore_color.rgb = CARD_BG
        c.line.color.rgb = CARD_BORDER

        tf = c.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.25)

        p1 = tf.paragraphs[0]
        p1.text = badge
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = GOLD

        p2 = tf.add_paragraph()
        p2.text = headline
        p2.font.size = Pt(17)
        p2.font.bold = True
        p2.font.color.rgb = BLUE_ACCENT
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = subtitle
        p3.font.size = Pt(12)
        p3.font.bold = True
        p3.font.color.rgb = TEXT_DARK
        p3.space_before = Pt(4)

        p4 = tf.add_paragraph()
        p4.text = desc
        p4.font.size = Pt(11)
        p4.font.color.rgb = TEXT_MUTED
        p4.space_before = Pt(8)

    # Strategic Drivers Bar
    bot_card = slide8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.2), Inches(11.733), Inches(1.6))
    bot_card.fill.solid()
    bot_card.fill.fore_color.rgb = CARD_BG
    bot_card.line.color.rgb = CARD_BORDER
    btf = bot_card.text_frame
    btf.word_wrap = True
    btf.margin_left = btf.margin_right = btf.margin_top = Inches(0.25)

    bp1 = btf.paragraphs[0]
    bp1.text = "CORE CATALYSTS ACCELERATING THE EXPONENTIAL INTELLIGENCE TRANSITION"
    bp1.font.size = Pt(11)
    bp1.font.bold = True
    bp1.font.color.rgb = GOLD

    bp2 = btf.add_paragraph()
    bp2.text = "1. Exponential Compute Scaling: Global datacenter and compute buildouts are compounding at unprecedented rates, rendering legacy software accounting models obsolete.\n2. Regulatory & Fiduciary Mandates: Directives such as the EU AI Act and NIST frameworks mandate cryptographically verifiable execution, provenance, and auditable accounting.\n3. Capital Market Integration: Institutional compute providers and hyperscalers require standardized asset backing, SLA guarantees, and clearing rails to fund continuous capacity expansion."
    bp2.font.size = Pt(11)
    bp2.font.color.rgb = TEXT_DARK
    bp2.space_before = Pt(6)

    # -------------------------------------------------------------------------
    # SLIDE 9: Founding Vision & Moats (Light Theme)
    # -------------------------------------------------------------------------
    slide9 = prs.slides.add_slide(blank_layout)
    add_bg(slide9, LIGHT_BG)
    add_header(slide9, "Competitive Moats", "Founding Vision & Financial Infrastructure Analogues")

    analogues = [
        ("SIA Layer (Accounting)", "IFRS / GAAP Foundation", "Global standard-setting body for intelligence asset recognition. Once enshrined in corporate audit workflows, switching costs are prohibitive."),
        ("SSI Layer (Attestation)", "Moody's / S&P / Lloyd's", "Cryptographic hardware-attested rating and verification agency. Provides independent assurance for mission-critical enterprise workloads."),
        ("SCIP & SII (Value/Index)", "MSCI / S&P Global Platts", "Canonical benchmark reference pricing, index licensing, and intelligence commodity feeds relied upon by financial institutions for trade valuation."),
        ("Settlement Rails", "DTCC / Euroclear / CLS", "Automated contract clearing, multi-cloud escrow settlement, and secondary capacity trading infrastructure with deep network effects.")
    ]

    card_w9 = Inches(2.78)
    gap9 = Inches(0.2)
    left9 = Inches(0.8)

    for i, (layer, analogue, details) in enumerate(analogues):
        cx = left9 + i * (card_w9 + gap9)
        c = slide9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, Inches(1.8), card_w9, Inches(5.0))
        c.fill.solid()
        c.fill.fore_color.rgb = CARD_BG
        c.line.color.rgb = CARD_BORDER

        tf = c.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.25)

        p1 = tf.paragraphs[0]
        p1.text = "SIDPA COMPONENT:"
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = GOLD

        p2 = tf.add_paragraph()
        p2.text = layer
        p2.font.size = Pt(14)
        p2.font.bold = True
        p2.font.color.rgb = TEXT_DARK
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = "FINANCIAL ANALOGUE:"
        p3.font.size = Pt(10)
        p3.font.bold = True
        p3.font.color.rgb = BLUE_ACCENT
        p3.space_before = Pt(14)

        p4 = tf.add_paragraph()
        p4.text = analogue
        p4.font.size = Pt(15)
        p4.font.bold = True
        p4.font.color.rgb = TEXT_DARK
        p4.space_before = Pt(4)

        p5 = tf.add_paragraph()
        p5.text = details
        p5.font.size = Pt(11)
        p5.font.color.rgb = TEXT_MUTED
        p5.space_before = Pt(14)

    # -------------------------------------------------------------------------
    # SLIDE 10: Conclusion & Call to Action (Dark Theme)
    # -------------------------------------------------------------------------
    slide10 = prs.slides.add_slide(blank_layout)
    add_bg(slide10, DARK_BG)

    add_header(slide10, "Institutional Imperative", "From Compute to Capital. From Intelligence to Asset.", is_dark=True)

    cta_box = slide10.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(11.733), Inches(1.2))
    ctf = cta_box.text_frame
    ctf.word_wrap = True
    ctf.margin_left = ctf.margin_right = ctf.margin_top = 0
    cp = ctf.paragraphs[0]
    cp.text = "The transition of artificial intelligence from an opaque technical capability into an audited, investable asset class begins with universal standards. The SIDPA Measurement Authority invites forward-thinking cloud providers, enterprise buyers, and assurance institutions to co-found the ecosystem."
    cp.font.size = Pt(15)
    cp.font.color.rgb = TEXT_LIGHT_MUTED

    cta_items = [
        ("01", "Join Working Groups", "Participate in WG-1 (SCIP Capacity), WG-2 (SSI Trust), WG-3 (IAF Accounting), or WG-4 (SII Markets) to shape ratified standards."),
        ("02", "Deploy PoC Enclaves", "Integrate the open-source reference telemetry daemon within AMD SEV-SNP or Intel TDX environments to verify attested IDU throughput."),
        ("03", "Shape the Accounting Standard", "Collaborate on the GAAP-aligned Intelligence Accounting Framework (IAF) to establish first-mover advantage in capitalized AI assets.")
    ]

    card_w10 = Inches(3.73)
    gap10 = Inches(0.27)
    left10 = Inches(0.8)

    for i, (step, title, details) in enumerate(cta_items):
        cx = left10 + i * (card_w10 + gap10)
        c = slide10.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, Inches(3.3), card_w10, Inches(2.6))
        c.fill.solid()
        c.fill.fore_color.rgb = DARK_CARD
        c.line.color.rgb = RGBColor(30, 41, 59)

        tf = c.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = Inches(0.3)

        p1 = tf.paragraphs[0]
        p1.text = step
        p1.font.size = Pt(14)
        p1.font.bold = True
        p1.font.color.rgb = GOLD_LIGHT

        p2 = tf.add_paragraph()
        p2.text = title
        p2.font.size = Pt(16)
        p2.font.bold = True
        p2.font.color.rgb = TEXT_LIGHT
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = details
        p3.font.size = Pt(11)
        p3.font.color.rgb = TEXT_LIGHT_MUTED
        p3.space_before = Pt(8)

    # Footer banner
    fin_box = slide10.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(6.2), Inches(11.733), Inches(0.65))
    fin_box.fill.solid()
    fin_box.fill.fore_color.rgb = RGBColor(15, 23, 42)
    fin_box.line.color.rgb = RGBColor(51, 65, 85)
    ftf = fin_box.text_frame
    ftf.vertical_anchor = MSO_ANCHOR.MIDDLE
    ftf.margin_left = Inches(0.3)
    p_fin = ftf.paragraphs[0]
    p_fin.text = "Secretariat Contact: consortium@sidpa.org   |   Standards Portal: https://standards.sidpa.org   |   Board of Governors"
    p_fin.font.size = Pt(11)
    p_fin.font.color.rgb = GOLD_LIGHT

    prs.save(output_path)
    print(f"Successfully created presentation: {output_path}")

if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 else "SIDPA_Executive_Presentation.pptx"
    build_presentation(out_file)

