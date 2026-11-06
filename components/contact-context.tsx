"use client";

import { createContext, useContext } from "react";
import { DEFAULT_CONTACT } from "@/lib/contact";
import type { Contact } from "@/lib/contact-format";

// Hands the shop's contact details (from the database, via the layout) to client components such as the checkout.
const Ctx = createContext<Contact>(DEFAULT_CONTACT);
export const ContactProvider = ({ value, children }: { value: Contact; children: React.ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useContact = () => useContext(Ctx);
