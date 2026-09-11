import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateMyProfile, getGetMyProfileQueryKey, getGetAuthMeQueryKey } from "@workspace/api-client-react";
import type { MemberProfile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

const baseProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  country: z.string().length(2, "Country code must be exactly 2 letters").regex(/^[A-Z]{2}$/, "Country code must be letters").toUpperCase(),
  city: z.string().min(1, "City is required").max(120),
  state: z.string().max(100).nullable().optional(),
  announcementConsent: z.boolean().default(false),
});

const profileSchema = baseProfileSchema.superRefine((data, ctx) => {
  if (data.country === "US" && (!data.state || data.state.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "State is required for US",
      path: ["state"],
    });
  }
});

type ProfileFormValues = z.infer<typeof baseProfileSchema>;

const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "AU", label: "Australia" },
  { value: "IN", label: "India" },
  { value: "PK", label: "Pakistan" },
  { value: "ZA", label: "Pakistan" }, // Fix: PK is Pakistan, ZA is South Africa
  { value: "SA", label: "Saudi Arabia" },
  { value: "AE", label: "United Arab Emirates" },
];
// Correcting ZA
COUNTRIES.find(c => c.value === "ZA")!.label = "South Africa";


interface ProfileFormProps {
  initialData?: MemberProfile;
  isOnboarding?: boolean;
}

export function ProfileForm({ initialData, isOnboarding = false }: ProfileFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [isOther, setIsOther] = useState(() => {
    if (!initialData?.country) return false;
    return !COUNTRIES.some(c => c.value === initialData.country);
  });

  // If onboarding, consent must be true to proceed initially. We can handle this logic in validation if needed,
  // but the server will enforce it. Let's add client-side check if isOnboarding.
  const schema = isOnboarding 
    ? baseProfileSchema.extend({ announcementConsent: z.boolean().refine(val => val === true, "Consent is required to continue") }).superRefine((data, ctx) => {
        if (data.country === "US" && (!data.state || data.state.trim() === "")) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "State is required for US", path: ["state"] });
        }
      })
    : profileSchema;

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: initialData?.firstName ?? "",
      lastName: initialData?.lastName ?? "",
      email: initialData?.email ?? "",
      country: initialData?.country ?? "",
      city: initialData?.city ?? "",
      state: initialData?.state ?? "",
      announcementConsent: initialData?.announcementConsent ?? false,
    },
  });

  const country = form.watch("country");
  
  // When country changes to non-US, clear state
  const prevCountry = useRef(country);
  useEffect(() => {
    if (prevCountry.current === "US" && country !== "US") {
      form.setValue("state", "");
    }
    prevCountry.current = country;
  }, [country, form]);

  const updateProfile = useUpdateMyProfile({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyProfileQueryKey(), data);
        queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() }); // Refresh auth me to clear onboardingRequired
        
        toast({
          title: isOnboarding ? "Welcome to AlKabirList!" : "Profile updated",
          description: isOnboarding ? "Your profile has been completed successfully." : "Your changes have been saved.",
        });
        
        if (isOnboarding) {
          setLocation("/member");
        }
      },
      onError: (err: any) => {
        toast({
          title: "Update failed",
          description: err?.message || "There was a problem updating your profile. Please try again.",
          variant: "destructive",
        });
      }
    }
  });

  function onSubmit(data: ProfileFormValues) {
    updateProfile.mutate({
      data: {
        ...data,
        state: data.state || null,
        email: data.email || undefined,
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <Input placeholder="John" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input placeholder="Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address</FormLabel>
              <FormControl>
                <Input placeholder="john@example.com" type="email" {...field} disabled={!!initialData?.email} />
              </FormControl>
              <FormDescription>
                {initialData?.email ? "Email address cannot be changed." : "Your primary contact email."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <Select 
                  onValueChange={(val) => {
                    if (val === "OTHER") {
                      setIsOther(true);
                      field.onChange("");
                    } else {
                      setIsOther(false);
                      field.onChange(val);
                    }
                  }} 
                  value={isOther ? "OTHER" : (field.value || undefined)}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-country">
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                {!isOther && <FormMessage />}
              </FormItem>
            )}
          />
          
          {isOther && (
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country Code</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="e.g. FR" 
                      maxLength={2} 
                      {...field} 
                      value={field.value} 
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase();
                        field.onChange(val);
                      }} 
                      data-testid="input-country-code"
                    />
                  </FormControl>
                  <FormDescription>2-letter ISO country code</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input placeholder="New York" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {country === "US" && (
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <Input placeholder="NY" maxLength={2} {...field} value={field.value || ""} onChange={(e) => field.onChange(e.target.value.toUpperCase())} />
                  </FormControl>
                  <FormDescription>2-letter state code</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="announcementConsent"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm bg-muted/30">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="checkbox-consent"
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>
                  Receive important announcements
                </FormLabel>
                <FormDescription>
                  We will only email you about crucial challenge updates, new features, and winner announcements. No spam.
                </FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <Button 
          type="submit" 
          className="w-full sm:w-auto" 
          disabled={updateProfile.isPending}
          data-testid="button-save-profile"
        >
          {updateProfile.isPending ? "Saving..." : isOnboarding ? "Complete Setup" : "Save Changes"}
        </Button>
      </form>
    </Form>
  );
}
