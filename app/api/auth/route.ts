import { NextRequest, NextResponse } from "next/server";
import { db }                        from "@/lib/db";
import { getSession }                from "@/lib/session";
import bcrypt                        from "bcryptjs";

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password required" },
        { status: 400 }
      );
    }

    const admin = await db.admin.findUnique({ where: { email } });

    if (!admin) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Update last login
    await db.admin.update({
      where: { id: admin.id },
      data:  { lastLogin: new Date() },
    });

    // Set session
    const session       = await getSession();
    session.isLoggedIn  = true;
    session.admin       = {
      id:    admin.id,
      email: admin.email,
      name:  admin.name,
      role:  admin.role,
    };
    await session.save();

    return NextResponse.json({
      success: true,
      data: {
        id:    admin.id,
        email: admin.email,
        name:  admin.name,
        role:  admin.role,
      },
    });
  } catch (error) {
    console.error("POST /api/auth/login:", error);
    return NextResponse.json(
      { success: false, error: "Login failed" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/auth/login (logout) ─────────────────────────────────────────
export async function DELETE() {
  const session      = await getSession();
  session.isLoggedIn = false;
  session.admin      = undefined;
  await session.save();
  return NextResponse.json({ success: true });
}
