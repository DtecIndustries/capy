# The Problem

This document describes the challenge we are solving, in our own words. It is based on the SD Worx challenge brief ("Unlock the Knowledge Within: Find it. Understand it. Trust it.") and on what the SD Worx team said during their presentation at the Tectonic Hackathon.

## The challenge in one sentence

How might we turn fragmented organisational knowledge into a trusted shared resource?

## Context: who SD Worx is

SD Worx helps organisations across Europe manage HR, payroll and workforce operations. They have been doing this for more than 80 years, with 10,000+ employees, 100,000+ customers and payroll reach in over 100 countries. That scale creates a huge amount of expertise, and it also makes that expertise hard to navigate.

Their work runs on three applications: **HR**, **Pay** and **Time**. Each application has its own team, and each team is responsible for certain domains (areas) within its application. Employees are often bound to specific clients, so what someone knows is frequently tied to the clients they serve.

## The hidden problem

Knowledge exists, but it is spread across many places:

- Policies, manuals, procedures and checklists
- SharePoint, email, chats and Teams channels
- Business applications and operational data
- **People's heads**, which is where some of the most valuable knowledge lives

Finding information is only the first step. A search can return ten answers and an AI assistant can summarise them. The harder question is whether an answer is **reliable, current, and relevant to this customer, country or situation**. This is a trust problem, not a search problem.

## Real situations they described

**The urgent customer question.** An AI assistant finds three documents: one recently updated, one without an owner, and one that may apply to another country. A colleague posts contradicting information in a Teams conversation. The employee has found information but still cannot act on it with confidence.

**The inherited client portfolio.** A payroll consultant takes over a client portfolio. Years ago, the handover might have been one document and a one-hour conversation. Today the knowledge is spread across documents, workflows, applications, business data and experts in different teams. The information exists, but confidence does not come automatically.

## What goes wrong

- Different tools return different documents, and it is unclear **which one to trust**
- Documents have no clear owner, or the owner has moved on
- Outdated versions keep circulating next to current ones
- Sources contradict each other and nobody notices
- It is unclear **who to contact** for a specific application, domain and client
- Expertise is tied to individuals and is lost or hard to reach when people change roles
- Uncertainty slows decisions, creates repeated work, and makes valuable expertise hard to reuse

## The questions behind the challenge

These are simple to ask and hard to answer:

1. What is reliable?
2. What is current?
3. What applies in this context?
4. Where are the gaps?
5. Who has the relevant expertise?
6. Which answer should a person trust?

## What SD Worx explicitly does not want

From the presentation:

- **No "SharePoint with search."** A better search box over the same documents is not the answer.
- **Not another agent.** Adding one more AI assistant to the pile does not solve the trust problem.
- **No black box.** Solutions should challenge the black box. Trust must be visible, explainable and useful, and the user should understand *why* an answer deserves confidence, not only receive one.

## What they are asking for

A focused proof of concept, not a platform. Pick one meaningful problem: one role, one workflow, one knowledge source or one trust signal. Make the moment of doubt tangible, then show how someone moves from **"I found something"** to **"I understand why I can rely on it."**

The brief lists four inspiration areas, offered as inspiration rather than a checklist:

| Area | Question |
|---|---|
| **Trust** | How might people recognise whether information is relevant and reliable? |
| **Capture** | How might valuable knowledge become accessible beyond inboxes, documents and siloed teams? |
| **Detect** | How might conflicting, duplicated, missing or outdated knowledge become visible? |
| **Connect** | How might people find the right expertise when documents are not enough? |

## How we frame the problem

Two questions come up again and again, always for a specific **application, domain and client**:

1. **Who knows about this?**
2. **What are the latest documents about this that we can actually trust?**

Everything in this project is built to answer those two questions with visible evidence, and to make the cleanup of outdated, orphaned and conflicting knowledge a by-product instead of a separate chore.

## Judging criteria (for reference)

| Criterion | Weight |
|---|---|
| Originality | 30% |
| Technical ability | 30% |
| Fit to the challenge | 30% |
| Security | 10% |

## Note on data

This repository contains only synthetic, invented data. No real SD Worx or client data is used.