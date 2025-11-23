ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "business_id" TO "businessId";
ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "is_default" TO "isDefault";
ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "created_by_user_id" TO "createdByUserId";
ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "updated_at" TO "updatedAt";

ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "business_id" TO "businessId";
ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "scope_type" TO "scopeType";
ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "scope_id" TO "scopeId";
ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "palette_id" TO "paletteId";
ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "updated_at" TO "updatedAt";
