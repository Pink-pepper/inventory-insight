# Inventory Insight

Build a functional MVP prototype for a B2B inventory and purchasing decision-intelligence SaaS called Ionic.

Product concept

The product helps growing distributors and inventory-based businesses answer one core question:

“What should I buy, when should I buy it, and how much should I buy?”

The customer's ERP remains their system of record. This product is a decision-intelligence layer that analyses sales, inventory, purchasing and supplier data and turns it into actionable recommendations.

This is a web-based multi-tenant B2B SaaS, not a mobile app.

For this prototype, do NOT build ERP integrations yet. Instead, create a CSV upload workflow that is architected so future ERP/API connectors can feed the same canonical data model.

Primary user

Operations, supply-chain, procurement or commercial managers at growing distributors.

The user should be able to:

Sign into a company workspace.

Upload a CSV containing inventory/sales data.

Have the system validate and process the data.

View an inventory health dashboard.

See which SKUs require action.

Drill into an SKU and understand WHY the system recommends an action.

MVP workflow

Create these main screens:

1. Login

Simple professional B2B SaaS login.

2. Company workspace

Show the company name, user profile and navigation.

Navigation:

Overview

Inventory

Recommendations

Data Sources

Settings

3. Data Sources

Create a CSV upload interface.

Explain that CSV is the current connector and ERP/API integrations will be available later.

Allow the user to upload a CSV.

For the prototype, also provide a “Load Demo Dataset” button so I can immediately experience the product without preparing a file.

4. Overview dashboard

Create a polished executive dashboard showing:

Total SKUs

SKUs requiring reorder

SKUs at stockout risk

SKUs with excess inventory

Estimated inventory value

Estimated excess working capital

Recommended purchasing requirement

Include charts showing:

Inventory value by category

Stock cover distribution

Reorder vs excess vs healthy inventory

Recent demand trend

5. Recommendations

Create a table of SKU-level recommendations.

Columns:

SKU

Product

Category

Current Stock

Average Monthly Demand

Days of Stock Cover

Supplier Lead Time

MOQ

Recommended Action

Recommended Order Quantity

Estimated Purchase Cost

Reason

Use clear status indicators:

REORDER

WATCH

HOLD

EXCESS

The recommendations should be calculated from the demo data rather than being purely decorative.

6. SKU detail

When a user clicks a SKU, show:

Current inventory

Recent demand trend

Average demand

Stock cover

Lead time

Safety stock

Reorder point

MOQ

Recommended order quantity

Estimated purchase cost

Most importantly, include an “Why this recommendation?” section explaining the recommendation in plain business language.

Example:

“Reorder 500 units. Current stock provides approximately 18 days of cover while supplier lead time is 30 days. Based on recent demand and the required safety-stock buffer, the system estimates a stockout risk before the next replenishment arrives. The recommended quantity respects the supplier MOQ.”

Decision logic

For the prototype, implement transparent rule-based inventory logic rather than AI.

Use:

Average demand from historical sales

Days of stock cover

Supplier lead time

Safety stock

Reorder point

MOQ

Current inventory

Unit cost

The exact formulas should be implemented as modular business-logic functions separate from the UI.

Do not hard-code recommendation results into the interface.

Make the logic easy to modify later.

Canonical data model

Design the application around a normalized internal data model rather than tying the product directly to CSV column names.

At minimum support:

Organization
User
Product
Sales
Inventory
Supplier
Purchase Order
Data Source
Recommendation

Every customer-owned record must be associated with an organization/tenant.

The architecture must allow future connectors such as:

Odoo

SAP

Microsoft Dynamics

NetSuite

custom APIs

to map their data into the same canonical model.

Security requirements

Treat this as a real B2B SaaS prototype.

Implement:

Authentication

Multi-tenant organization structure

Authorization

Row-level security where supported

Strict tenant isolation

Private customer data

Server-side handling of sensitive operations

Environment variables for secrets

No API keys or secrets in frontend code

Input validation

CSV file-type and file-size validation

Basic audit logging for login, upload, delete and recommendation-generation events

Do not trust organization IDs supplied by the client.

Do not allow one organization to access another organization's data.

Do not use fake security controls in the UI; enforce access at the appropriate backend/database layer.

Product architecture

Separate the application into:

Presentation/UI

Authentication and authorization

Data ingestion

Canonical data model/database

Inventory calculation/decision engine

Recommendation presentation

Keep business logic separate from UI components.

The CSV uploader should be treated as the first data connector, not as the fundamental architecture of the product.

Design

Make the interface feel like a serious modern B2B operations product rather than a generic AI startup.

Use:

Clean

Minimal

Professional

Data-dense but readable

Strong information hierarchy

Excellent tables

Clear status indicators

Useful empty states

Responsive desktop-first design

Avoid:

Excessive gradients

Generic AI imagery

Chatbot interfaces

Unnecessary animations

Marketing-style dashboards full of meaningless charts

The product should feel like something a procurement or supply-chain manager could actually use at work.

Demo dataset

Create a realistic demo dataset containing approximately:

50 SKUs

5 categories

8 suppliers

12 months of historical sales

Different lead times

Different MOQs

Different unit costs

Some fast-moving products

Some slow-moving products

Some products with excess stock

Some products approaching stockout

Some healthy products

Make the data internally consistent so the calculations produce believable recommendations.

Important constraint

This is an MVP prototype.

Do NOT build:

ERP integrations

Payments

Subscription billing

Mobile application

Supplier marketplace

Financing

Complex AI/LLM functionality

Microservices

Enterprise SSO

Advanced forecasting models

However, structure the application so these can be added later without rewriting the core product.

Before implementing, reason through the architecture and data relationships. Then build the working prototype.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/295dd74e-914c-4849-bd73-6095ac0fc6c2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
