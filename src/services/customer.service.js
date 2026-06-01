// Path: src/services/customer.service.js
// Purpose: Check / create customer contacts in Hesabfa from portal users

const toSafeString = (value) =>
  value === null || value === undefined ? "" : String(value).trim();

const normalizePhone = (value) => {
  if (!value) return "";
  const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(value)
    .replace(/[۰-۹]/g, (d) => persianDigits.indexOf(d))
    .replace(/\D/g, "");
};

const hasValue = (v) => v !== null && v !== undefined && v !== "";

const splitFullName = (fullName) => {
  const parts = toSafeString(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
};

// ✅ حسابفا List برمی‌گرداند نه Items — هر دو را handle کن
const extractList = (result) => {
  if (Array.isArray(result?.List)) return result.List;
  if (Array.isArray(result?.Items)) return result.Items;
  if (Array.isArray(result)) return result;
  return [];
};

export class CustomerService {
  constructor({ portalService, hesabfaService }) {
    if (!portalService) throw new Error("portalService is required");
    if (!hesabfaService) throw new Error("hesabfaService is required");

    this.portal = portalService;
    this.hesabfa = hesabfaService;
  }

  // ─── Get list of portal users ────────────────────────────────────
  async getPortalUsers({ page = 1, size = 100 } = {}) {
    const path = `/site/api/v1/manage/users`;
    const sep = path.includes("?") ? "&" : "?";
    const response = await this.portal.http.get(
      `${path}${sep}page=${page}&size=${size}`,
    );

    if (Array.isArray(response))
      return { users: response, total: response.length };
    if (Array.isArray(response?.data))
      return {
        users: response.data,
        total: response.total ?? response.data.length,
      };
    if (Array.isArray(response?.users))
      return {
        users: response.users,
        total: response.total ?? response.users.length,
      };
    if (Array.isArray(response?.items))
      return {
        users: response.items,
        total: response.total ?? response.items.length,
      };
    return { users: [], total: 0 };
  }

  // ─── Get single portal user ──────────────────────────────────────
  async getPortalUser(userId) {
    const response = await this.portal.http.get(
      `/site/api/v1/manage/users/${encodeURIComponent(String(userId))}`,
    );
    return response?.user ?? response?.data ?? response;
  }

  // ─── Normalize portal user → hesabfa contact shape ──────────────
  normalizeUserToContact(user) {
    let firstName = toSafeString(user?.first_name ?? user?.firstName ?? "");
    let lastName = toSafeString(
      user?.last_name ?? user?.lastName ?? user?.family ?? "",
    );

    if (!firstName && !lastName && hasValue(user?.name)) {
      const split = splitFullName(user.name);
      firstName = split.firstName;
      lastName = split.lastName;
    }

    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") || "کاربر سایت";
    const email = toSafeString(user?.email ?? "");
    const mobile = normalizePhone(
      user?.mobile ?? user?.phone ?? user?.cellphone ?? "",
    );
    const portalUserId = toSafeString(user?.id ?? user?.user_id ?? "");
    const tag = `portal_user_${portalUserId}`;

    return { firstName, lastName, fullName, email, mobile, tag, portalUserId };
  }

  // ─── user بدون اطلاعات قابل شناسایی → skip ──────────────────────
  _hasContactInfo(normalized) {
    return (
      hasValue(normalized.mobile) ||
      hasValue(normalized.email) ||
      normalized.fullName !== "کاربر سایت"
    );
  }

  // ─── جستجوی contact در حسابفا ───────────────────────────────────
  // ✅ operator باید * باشد نه = (حسابفا با = روی Mobile چیزی برنمی‌گرداند)
  // ✅ response key در حسابفا List است نه Items
  async findExistingContact(normalized) {
    // 1. جستجو با Mobile
    if (hasValue(normalized.mobile) && normalized.mobile.length >= 10) {
      try {
        const result = await this.hesabfa.call("/contact/getContacts", {
          queryInfo: {
            take: 20,
            skip: 0,
            sortBy: "Code",
            sortDesc: false,
            filters: [
              { property: "Mobile", operator: "*", value: normalized.mobile },
            ],
          },
        });

        const items = extractList(result);

        if (items.length > 0) {
          // اولویت ۱: contact که Tag مطابقت دارد
          const byTag = items.find((c) => c.Tag === normalized.tag);
          // اولویت ۲: contact اصلی کسب‌وکار (IsCustomer=true)
          const byCustomer = items.find((c) => c.IsCustomer === true);
          const picked = byTag ?? byCustomer ?? items[0];
          return {
            found: true,
            contact: picked,
            by: byTag
              ? "mobile+tag"
              : byCustomer
                ? "mobile+isCustomer"
                : "mobile",
            allFound: items.length,
          };
        }
      } catch {
        // ادامه
      }
    }

    // 2. جستجو با Email
    if (hasValue(normalized.email)) {
      try {
        const result = await this.hesabfa.call("/contact/getContacts", {
          queryInfo: {
            take: 10,
            skip: 0,
            sortBy: "Code",
            sortDesc: false,
            filters: [
              { property: "Email", operator: "*", value: normalized.email },
            ],
          },
        });

        const items = extractList(result);

        if (items.length > 0) {
          const byTag = items.find((c) => c.Tag === normalized.tag);
          const picked = byTag ?? items[0];
          return {
            found: true,
            contact: picked,
            by: byTag ? "email+tag" : "email",
          };
        }
      } catch {
        // ادامه
      }
    }

    // 3. جستجو با Name — آخرین تلاش
    if (normalized.fullName !== "کاربر سایت") {
      try {
        const result = await this.hesabfa.call("/contact/getContacts", {
          queryInfo: {
            take: 10,
            skip: 0,
            sortBy: "Code",
            sortDesc: false,
            filters: [
              { property: "Name", operator: "*", value: normalized.fullName },
            ],
          },
        });

        const items = extractList(result);

        if (items.length > 0) {
          const byTag = items.find((c) => c.Tag === normalized.tag);
          const picked = byTag ?? items[0];
          if (picked)
            return {
              found: true,
              contact: picked,
              by: byTag ? "name+tag" : "name",
            };
        }
      } catch {
        // ادامه
      }
    }

    return { found: false, contact: null, by: null };
  }

  // ─── ایجاد contact در حسابفا ─────────────────────────────────────
  async createContact(normalized) {
    const payload = {
      contact: {
        name: normalized.fullName,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        contactType: 0, // 0 = حقیقی، 1 = حقوقی
        tag: normalized.tag,
        ...(hasValue(normalized.email) && { email: normalized.email }),
        ...(hasValue(normalized.mobile) && { mobile: normalized.mobile }),
      },
    };

    return this.hesabfa.call("/contact/save", payload);
  }

  // ─── حذف contact از حسابفا ──────────────────────────────────────
  async deleteContact(code) {
    return this.hesabfa.call("/contact/delete", { code: String(code) });
  }

  // ─── اطمینان از وجود contact، برگرداندن contactCode ─────────────
  async ensureContact(user) {
    const normalized = this.normalizeUserToContact(user);

    // user بدون اطلاعات → skip
    if (!this._hasContactInfo(normalized)) {
      return {
        action: "skipped",
        reason: "no_contact_info",
        contactCode: null,
        normalized,
      };
    }

    const { found, contact, by, allFound } =
      await this.findExistingContact(normalized);

    if (found) {
      const code =
        contact?.Code ??
        contact?.code ??
        contact?.ContactCode ??
        contact?.contactCode;
      return {
        action: "already_exists",
        contactCode: code,
        by,
        allFound,
        contact,
        normalized,
      };
    }

    const result = await this.createContact(normalized);

    const code =
      typeof result === "number"
        ? result
        : (result?.Code ??
          result?.code ??
          result?.ContactCode ??
          result?.contactCode ??
          null);

    return {
      action: "created",
      contactCode: code,
      contact: result,
      normalized,
    };
  }

  // ─── پاک‌سازی contact‌های تکراری با همان mobile ─────────────────
  // contact با IsCustomer=true یا Tag اولویت دارد — بقیه حذف می‌شوند
  async deduplicateByMobile(mobile) {
    try {
      const result = await this.hesabfa.call("/contact/getContacts", {
        queryInfo: {
          take: 50,
          skip: 0,
          sortBy: "Code",
          sortDesc: false,
          filters: [{ property: "Mobile", operator: "*", value: mobile }],
        },
      });

      const items = extractList(result);

      if (items.length === 0)
        return { kept: null, deleted: [], note: "not found" };
      if (items.length === 1) return { kept: items[0].Code, deleted: [] };

      // اولویت نگه‌داشتن: IsCustomer=true > دارای Tag > اولین آیتم
      const keep =
        items.find((c) => c.IsCustomer === true) ??
        items.find(
          (c) => hasValue(c.Tag) && c.Tag.startsWith("portal_user_"),
        ) ??
        items[0];

      const duplicates = items.filter((c) => c.Code !== keep.Code);
      const deleted = [];
      const errors = [];

      for (const dup of duplicates) {
        const dupCode = dup?.Code ?? dup?.code;
        if (dupCode) {
          try {
            await this.deleteContact(dupCode);
            deleted.push(dupCode);
          } catch (err) {
            errors.push({ code: dupCode, error: err?.message ?? String(err) });
          }
        }
      }

      return { kept: keep.Code, deleted, errors };
    } catch (err) {
      return { error: err?.message ?? String(err) };
    }
  }

  // ─── Sync همه کاربران پورتال → حسابفا ───────────────────────────
  async syncAllUsers({ pageSize = 100, dryRun = false } = {}) {
    const stats = {
      total: 0,
      created: 0,
      already_exists: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    let page = 1;

    while (true) {
      const { users, total } = await this.getPortalUsers({
        page,
        size: pageSize,
      });
      if (users.length === 0) break;

      stats.total += users.length;

      for (const user of users) {
        try {
          if (dryRun) {
            stats.skipped++;
            continue;
          }

          const result = await this.ensureContact(user);
          if (result.action === "created") stats.created++;
          else if (result.action === "skipped") stats.skipped++;
          else stats.already_exists++;
        } catch (err) {
          stats.failed++;
          stats.errors.push({
            userId: user?.id ?? user?.user_id,
            error: err?.message ?? String(err),
          });
        }
      }

      if (users.length < pageSize || stats.total >= total) break;
      page++;
    }

    return stats;
  }
}
