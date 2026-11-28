import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { GlassButton } from "@/components/GlassButton";
import { useAppPopup } from "@/components/AppPopupProvider";
import { useTheme } from "@/constants/colors";
import { supabase, pendingOperations } from "@/lib/supabase";
import {
  invitationDigest,
  type HouseholdInvitations,
} from "@/lib/householdInvitations";

export function HouseholdInvitationControls({
  householdId,
  userId,
  onChanged,
}: {
  householdId: string;
  userId: string;
  onChanged: () => void;
}) {
  const colors = useTheme(),
    { showPopup } = useAppPopup();
  const scope = `${userId}:${householdId}`,
    current = useRef(scope);
  current.current = scope;
  const alive = useRef(true),
    requestVersion = useRef(0),
    lock = useRef("");
  const drafts = useRef(new Map<string, string>());
  const [openScope, setOpenScope] = useState("");
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    data: HouseholdInvitations;
  } | null>(null);
  const [loadingScope, setLoadingScope] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [working, setWorking] = useState("");
  const [error, setError] = useState<{ scope: string; message: string } | null>(
    null,
  );
  const [issued, setIssued] = useState<{
    scope: string;
    code: string;
    name: string;
    expires: string;
    id: string;
  } | null>(null);
  const open = openScope === scope,
    data = snapshot?.scope === scope ? snapshot.data : null,
    busy = working.startsWith(scope + "/");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestVersion.current++;
      drafts.current.clear();
    };
  }, [scope]);
  const assertCurrent = () => {
    if (!alive.current || current.current !== scope)
      throw new Error("Your household changed. Reopen invitation controls.");
  };
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoadingScope(scope);
    try {
      const { data: result, error: failure } = await supabase.rpc(
        "get_household_invitations",
        { target_household_id: householdId },
      );
      if (
        !alive.current ||
        current.current !== scope ||
        version !== requestVersion.current
      )
        return;
      if (failure) throw failure;
      setSnapshot({ scope, data: result as HouseholdInvitations });
      setError(null);
      setLoadingScope("");
    } catch (failure) {
      if (
        alive.current &&
        current.current === scope &&
        version === requestVersion.current
      ) {
        setError({
          scope,
          message:
            failure instanceof Error
              ? failure.message
              : "Invitations could not load. Try again.",
        });
        setLoadingScope("");
      }
    }
  }, [scope, householdId]);
  useEffect(() => {
    if (!open) return;
    void load();
    const subscription = pendingOperations?.subscribeRecovery(
      () => void load(),
    );
    const channel = supabase
      .channel(`host-invitations:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_members",
          filter: `household_id=eq.${householdId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      subscription?.();
      void supabase.removeChannel(channel);
    };
  }, [open, load, householdId]);
  const run = async (key: string, work: () => Promise<void>) => {
    if (lock.current.startsWith(scope + "/")) return;
    assertCurrent();
    lock.current = `${scope}/${key}`;
    setWorking(lock.current);
    setError(null);
    try {
      await work();
      assertCurrent();
      await load();
      onChanged();
    } catch (failure) {
      if (alive.current && current.current === scope)
        setError({
          scope,
          message:
            failure instanceof Error
              ? failure.message
              : "This change could not be confirmed. Try again.",
        });
    } finally {
      if (alive.current && current.current === scope) {
        lock.current = "";
        setWorking("");
      }
    }
  };
  const mutate = async (
    name:
      | "manage_household_invites"
      | "create_household_reinvitation"
      | "revoke_household_reinvitation",
    args: Record<string, unknown>,
  ) => {
    assertCurrent();
    const { data: result, error: failure } = await supabase.rpc(name, {
      target_household_id: householdId,
      ...args,
    });
    assertCurrent();
    if (failure) throw new Error(failure.message);
    if (result?.ok !== true)
      throw new Error(
        result?.message ?? "This change could not be confirmed. Try again.",
      );
    return result;
  };
  const manage = (action: "rotate" | "pause" | "resume") =>
    void run(action, async () => {
      await mutate("manage_household_invites", { invite_action: action });
      setIssued(null);
    });
  const confirmManage = (action: "rotate" | "pause") =>
    showPopup({
      title:
        action === "pause"
          ? "Pause all invitations?"
          : "Replace invitation code?",
      message:
        "Old shared codes, personal invitations and rejoin approvals will stop working. Current Sweetmates keep their access.",
      actions: [
        { label: "Cancel" },
        {
          label: action === "pause" ? "Pause invitations" : "Replace code",
          destructive: true,
          onPress: () => manage(action),
        },
      ],
    });
  const reinvite = (member: { id: string; name: string }, personal: boolean) =>
    void run(member.id, async () => {
      let token: string | null = null,
        hash: string | null = null;
      if (personal) {
        token =
          drafts.current.get(member.id) ??
          Crypto.randomUUID().replace(/-/g, "").toUpperCase();
        drafts.current.set(member.id, token);
        hash = await invitationDigest(token);
      }
      const result = await mutate("create_household_reinvitation", {
        target_user_id: member.id,
        token_hash: hash,
        token_suffix: token?.slice(-4) ?? null,
      });
      if (token)
        setIssued({
          scope,
          code: token,
          name: member.name,
          expires: result.expires_at,
          id: result.id,
        });
      else setIssued(null);
      drafts.current.delete(member.id);
    });
  const copyIssued = async () => {
    if (issued?.scope !== scope) return;
    try {
      await Clipboard.setStringAsync(issued.code);
      if (alive.current && current.current === scope) setCopiedId(issued.id);
    } catch {
      setError({
        scope,
        message:
          "The code could not be copied. Select it to copy, or try again.",
      });
    }
  };
  const button = (
    title: string,
    onPress: () => void,
    destructive = false,
    visibleTitle = title,
  ) => (
    <GlassButton
      key={title}
      accessibilityLabel={title}
      disabled={busy}
      tone={destructive ? "destructive" : "neutral"}
      onPress={onPress}
      style={styles.button}
    >
      <Text
        style={[
          styles.buttonText,
          {
            color: destructive
              ? colors.destructiveForeground
              : colors.foreground,
          },
        ]}
      >
        {visibleTitle}
      </Text>
    </GlassButton>
  );
  return (
    <View style={styles.section}>
      <GlassButton
        accessibilityLabel="Invitation controls"
        accessibilityState={{ expanded: open }}
        tone="neutral"
        onPress={() => setOpenScope(open ? "" : scope)}
        style={styles.heading}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          Invitation controls
        </Text>
        <Feather
          name={open ? "chevron-down" : "chevron-right"}
          size={18}
          color={colors.mutedForeground}
        />
      </GlassButton>
      {open && (
        <View
          style={[
            styles.body,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {busy && (
            <ActivityIndicator
              accessibilityLabel="Saving invitation change"
              color={colors.primary}
            />
          )}
          {error?.scope === scope && (
            <Text
              accessibilityRole="alert"
              style={[styles.copy, { color: colors.destructive }]}
            >
              {error.message}
            </Text>
          )}
          {!data ? (
            loadingScope === scope ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.copy, { color: colors.mutedForeground }]}
              >
                Loading invitations…
              </Text>
            ) : (
              button("Reload invitations", () => void load())
            )
          ) : (
            <>
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                {data.enabled
                  ? "Invitations are enabled."
                  : "Invitations are paused."}{" "}
                Personal invitations and approvals expire after 7 days.
              </Text>
              <View style={styles.actions}>
                {data.enabled ? (
                  <>
                    {button("Replace code", () => confirmManage("rotate"))}
                    {button(
                      "Pause invitations",
                      () => confirmManage("pause"),
                      true,
                    )}
                  </>
                ) : (
                  button("Enable invitations", () => manage("resume"))
                )}
              </View>
              {issued?.scope === scope &&
                data.invitations.some((grant) => grant.id === issued.id) && (
                  <View style={styles.issued}>
                    <Text style={[styles.copy, { color: colors.foreground }]}>
                      Personal invitation for {issued.name}
                    </Text>
                    <Text
                      selectable
                      style={[styles.code, { color: colors.foreground }]}
                    >
                      {issued.code}
                    </Text>
                    <Text
                      style={[styles.copy, { color: colors.mutedForeground }]}
                    >
                      Only this account can use it. Expires{" "}
                      {new Date(issued.expires).toLocaleDateString()}. Copy it
                      before leaving this screen.
                    </Text>
                    {button("Copy personal code", () => void copyIssued())}
                    {copiedId === issued.id && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[styles.copy, { color: colors.mutedForeground }]}
                      >
                        Personal code copied.
                      </Text>
                    )}
                  </View>
                )}
              {data.removed.map((member) => {
                const grant = data.invitations.find(
                  (entry) => entry.user_id === member.id,
                );
                return (
                  <View
                    key={member.id}
                    style={[styles.member, { borderTopColor: colors.border }]}
                  >
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {member.name}
                    </Text>
                    <Text
                      style={[styles.copy, { color: colors.mutedForeground }]}
                    >
                      {grant
                        ? grant.approval_only
                          ? "Approved to rejoin with the current household code."
                          : `Personal invitation ending ${grant.suffix}.`
                        : "Removed · needs a new invitation or approval."}
                    </Text>
                    {grant && (
                      <Text
                        style={[styles.copy, { color: colors.mutedForeground }]}
                      >
                        Expires{" "}
                        {new Date(grant.expires_at).toLocaleDateString()}
                      </Text>
                    )}
                    {data.enabled && (
                      <View style={styles.actions}>
                        {button(
                          `Approve ${member.name} to rejoin`,
                          () => reinvite(member, false),
                          false,
                          "Approve rejoin",
                        )}
                        {button(
                          `Create invitation for ${member.name}`,
                          () => reinvite(member, true),
                          false,
                          "Create invitation",
                        )}
                      </View>
                    )}
                    {grant &&
                      button(
                        `Revoke ${member.name}'s invitation`,
                        () =>
                          void run(grant.id, async () => {
                            await mutate("revoke_household_reinvitation", {
                              invitation_id: grant.id,
                            });
                            if (
                              issued?.scope === scope &&
                              issued.id === grant.id
                            )
                              setIssued(null);
                          }),
                        true,
                        "Revoke invitation",
                      )}
                  </View>
                );
              })}
            </>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { marginTop: 14, gap: 10 },
  heading: {
    minHeight: 50,
    paddingHorizontal: 0,
    paddingVertical: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 23 },
  body: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 14 },
  copy: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 50,
    minWidth: 120,
    paddingHorizontal: 0,
    paddingVertical: 0,
    flexShrink: 1,
  },
  buttonText: {
    flexShrink: 1,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    lineHeight: 20,
  },
  member: { borderTopWidth: 1, paddingTop: 14, gap: 10 },
  issued: { gap: 10 },
  code: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    lineHeight: 25,
    letterSpacing: 1,
  },
});
