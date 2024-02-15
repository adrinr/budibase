import {
  Response,
  default as fetch,
  type RequestInit,
  Headers,
  HeadersInit,
} from "node-fetch"
import env from "../environment"
import { checkSlashesInUrl } from "./index"
import {
  db as dbCore,
  constants,
  tenancy,
  logging,
  env as coreEnv,
} from "@budibase/backend-core"
import { Ctx, User, EmailInvite } from "@budibase/types"

function ensureHeadersIsObject(headers: HeadersInit | undefined): Headers {
  if (headers instanceof Headers) {
    return headers
  }

  const headersObj = new Headers()
  if (headers === undefined) {
    return headersObj
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      headersObj.append(key, value)
    }
  } else {
    for (const key in headers) {
      headersObj.append(key, headers[key])
    }
  }
  return headersObj
}

export function request(request: RequestInit & { ctx?: Ctx }): RequestInit {
  const ctx = request.ctx
  request.headers = ensureHeadersIsObject(request.headers)

  if (!ctx) {
    if (coreEnv.INTERNAL_API_KEY) {
      request.headers.set(constants.Header.API_KEY, coreEnv.INTERNAL_API_KEY)
    }
  } else if (ctx.headers) {
    // copy all Budibase utilised headers over - copying everything can have
    // side effects like requests being rejected due to odd content types etc
    for (let header of Object.values(constants.Header)) {
      const value = ctx.headers[header]
      if (value === undefined) {
        continue
      }

      if (Array.isArray(value)) {
        for (let v of value) {
          request.headers.append(header, v)
        }
      } else {
        request.headers.set(header, value)
      }
    }
  }

  // apply tenancy if its available
  if (tenancy.isTenantIdSet()) {
    request.headers.set(constants.Header.TENANT_ID, tenancy.getTenantId())
  }
  if (request.body && Object.keys(request.body).length > 0) {
    request.headers.set("Content-Type", "application/json")
    request.body =
      typeof request.body === "object"
        ? JSON.stringify(request.body)
        : request.body
  } else {
    delete request.body
  }

  // add x-budibase-correlation-id header
  logging.correlation.setHeader(request.headers)

  delete request.ctx
  return request
}

async function checkResponse(
  response: Response,
  errorMsg: string,
  { ctx }: { ctx?: Ctx } = {}
) {
  if (response.status >= 300) {
    let responseErrorMessage
    if (response.headers.get("content-type")?.includes("json")) {
      const error = await response.json()
      responseErrorMessage = error.message ?? JSON.stringify(error)
    } else {
      responseErrorMessage = await response.text()
    }
    const msg = `Unable to ${errorMsg} - ${responseErrorMessage}`
    if (ctx) {
      ctx.throw(response.status || 500, msg)
    } else {
      throw msg
    }
  }
  return response.json()
}

// have to pass in the tenant ID as this could be coming from an automation
export async function sendSmtpEmail({
  to,
  from,
  subject,
  contents,
  cc,
  bcc,
  automation,
  invite,
}: {
  to: string
  from: string
  subject: string
  contents: string
  cc: string
  bcc: string
  automation: boolean
  invite?: EmailInvite
}) {
  // tenant ID will be set in header
  const response = await fetch(
    checkSlashesInUrl(env.WORKER_URL + `/api/global/email/send`),
    request({
      method: "POST",
      body: JSON.stringify({
        email: to,
        from,
        contents,
        subject,
        cc,
        bcc,
        purpose: "custom",
        automation,
        invite,
      }),
    })
  )
  return checkResponse(response, "send email")
}

export async function removeAppFromUserRoles(ctx: Ctx, appId: string) {
  const prodAppId = dbCore.getProdAppID(appId)
  const response = await fetch(
    checkSlashesInUrl(env.WORKER_URL + `/api/global/roles/${prodAppId}`),
    request({
      ctx,
      method: "DELETE",
    })
  )
  return checkResponse(response, "remove app role")
}

export async function allGlobalUsers(ctx: Ctx) {
  const response = await fetch(
    checkSlashesInUrl(env.WORKER_URL + "/api/global/users"),
    // we don't want to use API key when getting self
    request({ ctx, method: "GET" })
  )
  return checkResponse(response, "get users", { ctx })
}

export async function saveGlobalUser(ctx: Ctx) {
  const response = await fetch(
    checkSlashesInUrl(env.WORKER_URL + "/api/global/users"),
    // we don't want to use API key when getting self
    request({ ctx, method: "POST", body: ctx.request.body })
  )
  return checkResponse(response, "save user", { ctx })
}

export async function deleteGlobalUser(ctx: Ctx) {
  const response = await fetch(
    checkSlashesInUrl(
      env.WORKER_URL + `/api/global/users/${ctx.params.userId}`
    ),
    // we don't want to use API key when getting self
    request({ ctx, method: "DELETE" })
  )
  return checkResponse(response, "delete user", { ctx })
}

export async function readGlobalUser(ctx: Ctx): Promise<User> {
  const response = await fetch(
    checkSlashesInUrl(
      env.WORKER_URL + `/api/global/users/${ctx.params.userId}`
    ),
    // we don't want to use API key when getting self
    request({ ctx, method: "GET" })
  )
  return checkResponse(response, "get user", { ctx })
}

export async function getChecklist(): Promise<{
  adminUser: { checked: boolean }
}> {
  const response = await fetch(
    checkSlashesInUrl(env.WORKER_URL + "/api/global/configs/checklist"),
    request({ method: "GET" })
  )
  return checkResponse(response, "get checklist")
}

export async function generateApiKey(userId: string) {
  const response = await fetch(
    checkSlashesInUrl(env.WORKER_URL + "/api/global/self/api_key"),
    request({ method: "POST", body: JSON.stringify({ userId }) })
  )
  return checkResponse(response, "generate API key")
}
