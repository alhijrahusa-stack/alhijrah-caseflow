DO $migration$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND to_regtype('public.user_role') IS NOT NULL
     AND to_regprocedure('public.handle_new_user()') IS NOT NULL
  THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $function$
      BEGIN
        INSERT INTO public.profiles (id, phone, email, role)
        VALUES (
          NEW.id,
          NEW.phone,
          NEW.email,
          CASE
            WHEN NEW.raw_app_meta_data ->> 'role' IN
                 ('seeker', 'employer', 'employer_member', 'recruiter', 'moderator', 'admin')
            THEN (NEW.raw_app_meta_data ->> 'role')::public.user_role
            ELSE 'seeker'::public.user_role
          END
        );
        RETURN NEW;
      END
      $function$;
    $definition$;
    REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
  END IF;
END
$migration$;
