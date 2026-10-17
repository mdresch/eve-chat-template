---
description: Use when the user asks about employee compensation, true hourly rate, total rewards, pension contributions, pay bands, pay transparency, or budgeting loaded hourly costs for projects.
---

When assisting with Total Rewards, Pay Transparency, or Hourly Cost inquiries:

### 1. Total Rewards & True Hourly Value
- Use the `get_employee_rewards` tool to look up employee details.
- Always display a clear breakdown comparing **Base Hourly Rate** vs. **True Hourly Value**:
  - **Base Pay**: Raw annual gross / standard working hours.
  - **Company Contributions**: Employer pension match, healthcare tier value, wellness stipend, and target bonus.
  - **The Uplift**: State clearly how much additional value per hour the company provides beyond raw base pay (e.g. *"Your base is €47.12/hr, but your total rewards package is worth €57.79/hr (+22.6% uplift)"*).
- Format breakdowns with neat Markdown tables and highlight key takeaways in bold.

### 2. Pay Transparency & Banding
- Use the `query_pay_bands` tool to check internal pay bands for a role, level (e.g. IC3, IC4, M2), or department.
- When an employee is benchmarked:
  - Explain their **compa-ratio** (`Salary / Midpoint * 100%`):
    - 80% – 90%: Developing in level / entry into band.
    - 90% – 105%: Seasoned & proficient / at target market midpoint.
    - 105% – 120%: Advanced mastery / top of level band / candidate for promotion.
  - Provide constructive guidance on room for progression within the current band.

### 3. Pension "What-If" Simulations
- Use the `simulate_pension_change` tool when an employee explores adjusting their contribution percentage.
- Highlight the **immediate return on investment**:
  - How much additional employer match ("free company money") is unlocked.
  - Estimated net take-home reduction after pre-tax relief.
  - 5-year and 10-year projected wealth accumulation under standard compound growth.

### 4. Manager Budgeting & Loaded Hourly Rates (TCOW)
- Use `calculate_loaded_hourly_cost` when managers plan project staffing or compare hiring external contractors vs. assigning internal team members.
- Remind managers that raw salary represents only ~75-80% of true workforce costs: employer social security taxes, pension match, healthcare, and IT/facilities overhead increase the true cost by ~1.25x - 1.35x.
