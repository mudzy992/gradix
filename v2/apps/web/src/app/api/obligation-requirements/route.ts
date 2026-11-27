/**
 * GET  /api/obligation-requirements — pravila „svaki X mora imati Y“ (§3).
 * POST /api/obligation-requirements — novo pravilo.
 *
 * Zašto pravilo nije u kodu: „ljekarski za sve“ je politika firme, a ne zakon. Kad se promijeni,
 * mijenja se podatak — bez migracije i bez ponovnog deploya.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import {
  createRequirement,
  listRequirements,
  type RequirementInput,
  requirementErrorCode,
} from "@/server/obligation-requirement-service";

export const dynamic = "force-dynamic";

const ENTITY_KINDS = ["WORKER", "MACHINE", "PROJECT"] as const;
const SCOPES = ["ALL", "ENGAGEMENT", "MACHINE_CATEGORY", "PROJECT"] as const;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.view");
    if (!guardResult.ok) return guardResult.response;

    const params = request.nextUrl.searchParams;
    const result = await listRequirements(await getVerifiedPool(), guardResult.ctx.companyId, {
      entityKind: params.get("entityKind") ?? undefined,
      includeInactive: params.get("includeInactive") === "1",
    });
    return ok({ requirements: result });
  } catch (error) {
    return internal(error, "obligation-requirements.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as Partial<RequirementInput> | null;
    if (!body) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    // Validacija je obična, ne schema: polja su tri enumeracije i jedan tekst. Schema bi
    // dodala zavisnost bez pokrivanja ijednog slučaja više — opseg↔vrijednost se provjerava
    // u servisu jer to pravilo dijeli sa POST-om.
    if (!ENTITY_KINDS.includes(body.entityKind as (typeof ENTITY_KINDS)[number])) {
      return fail("VALIDATION_FAILED", "Vrsta entiteta mora biti WORKER, MACHINE ili PROJECT.");
    }
    if (!SCOPES.includes(body.appliesScope as (typeof SCOPES)[number])) {
      return fail("VALIDATION_FAILED", "Opseg pravila nije ispravan.");
    }
    if (typeof body.typeId !== "string" || body.typeId.length === 0) {
      return fail("VALIDATION_FAILED", "Tip obaveze je obavezan.");
    }

    const result = await createRequirement(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        entityKind: body.entityKind as RequirementInput["entityKind"],
        typeId: body.typeId,
        appliesScope: body.appliesScope as RequirementInput["appliesScope"],
        appliesValue: typeof body.appliesValue === "string" ? body.appliesValue : null,
        isRequired: body.isRequired ?? true,
        isActive: body.isActive ?? true,
      },
      guardResult.ctx,
    );
    if (!result.ok) return fail(requirementErrorCode(result.code), result.message);
    return ok({ requirement: result.requirement });
  } catch (error) {
    return internal(error, "obligation-requirements.create");
  }
}
