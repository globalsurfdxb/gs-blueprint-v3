"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageClients, canCreateClient, isAdmin } from "@/lib/permissions";

async function requireClientManager() {
  const user = await getCurrentUser();
  if (!user || !canManageClients(user)) {
    throw new Error("You don't have permission to manage clients.");
  }
  return user;
}

async function requireClientCreator() {
  const user = await getCurrentUser();
  if (!user || !canCreateClient(user)) {
    throw new Error("Only an Admin or Accountant can create a new client.");
  }
  return user;
}

const clientSchema = z.object({
  name: z.string().min(1, "Client name is required."),
  industry: z.string().optional(),
  contactPerson: z.string().optional(),
  contactEmail: z.string().email("Enter a valid email.").optional().or(z.literal("")),
  accountOwnerId: z.string().optional(),
});

function parseClientForm(formData: FormData) {
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    industry: formData.get("industry") || undefined,
    contactPerson: formData.get("contactPerson") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    accountOwnerId: formData.get("accountOwnerId") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  return parsed.data;
}

export async function createClient(formData: FormData) {
  const user = await requireClientCreator();
  const data = parseClientForm(formData);

  // Accountant is intake-only — their form never renders the Account Owner field, so
  // ignore it even if present rather than letting a bypassed submission set it.
  const canSetOwner = isAdmin(user);

  const client = await prisma.client.create({
    data: {
      name: data.name,
      industry: data.industry,
      contactPerson: data.contactPerson,
      contactEmail: data.contactEmail || undefined,
      accountOwnerId: canSetOwner ? data.accountOwnerId : undefined,
    },
  });

  revalidatePath("/clients");
  // Accountant can't view the client detail page (intake-only) — send them back to the
  // Dashboard instead of a page that would immediately bounce them.
  redirect(isAdmin(user) ? `/clients/${client.id}` : "/");
}

export async function updateClient(clientId: string, formData: FormData) {
  await requireClientManager();
  const data = parseClientForm(formData);

  await prisma.client.update({
    where: { id: clientId },
    data: {
      name: data.name,
      industry: data.industry,
      contactPerson: data.contactPerson,
      contactEmail: data.contactEmail || null,
      accountOwnerId: data.accountOwnerId || null,
    },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}

/**
 * Permanently deletes a client — Admin only. Refused while the client still has projects
 * (every project requires a client), so delete or reassign those projects first.
 */
export async function deleteClient(
  clientId: string,
  _prevState: { error?: string } | undefined,
  _formData: FormData,
): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { error: "Only an Admin can delete a client." };

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, _count: { select: { projects: true } } },
  });
  if (!client) return { error: "Client not found." };
  if (client._count.projects > 0) {
    const n = client._count.projects;
    return {
      error: `This client still has ${n} project${n === 1 ? "" : "s"} (including archived ones). Delete those projects first, then delete the client.`,
    };
  }

  await prisma.client.delete({ where: { id: clientId } });

  revalidatePath("/clients");
  redirect("/clients");
}
