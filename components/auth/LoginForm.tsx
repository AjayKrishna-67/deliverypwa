'use client';

/**
 * Login form component.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/providers/AuthProvider';
import { Spinner } from '@/components/ui/Spinner';

export function LoginForm() {
    const router = useRouter();
    const { login } = useAuth();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            const result = await login(username, password);
            if (result.success) {
                router.replace('/');
            } else {
                setError(result.error ?? 'Invalid credentials');
            }
        } catch {
            setError('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="relative flex items-center justify-center min-h-dvh p-6 overflow-hidden">
            {/* Ambient background orbs */}
            <div className="absolute w-[400px] h-[400px] rounded-full blur-[100px] opacity-35 pointer-events-none animate-[orb-float_12s_ease-in-out_infinite] bg-indigo-500 -top-[10%] -left-[10%]" />
            <div className="absolute w-[300px] h-[300px] rounded-full blur-[100px] opacity-35 pointer-events-none animate-[orb-float_12s_ease-in-out_infinite_-4s] bg-purple-500 -bottom-[5%] -right-[5%]" />
            <div className="absolute w-[250px] h-[250px] rounded-full blur-[100px] opacity-35 pointer-events-none animate-[orb-float_12s_ease-in-out_infinite_-8s] bg-violet-400 top-1/2 left-[60%]" />

            <div className="relative w-full max-w-[400px] px-8 py-10 rounded-3xl bg-[var(--card-bg)] border border-[var(--card-border)] backdrop-blur-[40px] shadow-[0_0_0_1px_rgb(var(--overlay-rgb)/0.03),var(--shadow-modal)] animate-[card-enter_0.6s_cubic-bezier(0.16,1,0.3,1)_both]">
                {/* Logo */}
                <div className="flex justify-center mb-6">
                    <Image
                        src="/kaaikanilogo.png"
                        alt="Kaaikani"
                        width={72}
                        height={72}
                        priority
                        unoptimized
                        className="rounded-2xl shadow-[0_4px_20px_rgba(99,102,241,0.2)]"
                    />
                </div>

                <h1 className="text-center text-2xl font-bold tracking-tight mb-1 text-[var(--foreground)]">
                    Welcome Back
                </h1>
                <p className="text-center text-sm text-[var(--text-muted)] mb-7">
                    Sign in to your delivery dashboard
                </p>

                {/* Error */}
                {error && (
                    <div
                        className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--error-bg)] text-[var(--error)] text-[0.8125rem] font-medium mb-5 animate-[shake_0.4s_ease-in-out]"
                        role="alert"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <circle cx="8" cy="11" r="0.75" fill="currentColor" />
                        </svg>
                        <span>{error}</span>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="username" className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Username
                        </label>
                        <input
                            id="username"
                            type="text"
                            autoComplete="username"
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.9375rem] outline-none transition-all duration-200 placeholder:text-foreground/25 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--input-focus)] disabled:opacity-50 disabled:cursor-not-allowed"
                            placeholder="Enter your username"
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="password" className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Password
                        </label>
                        <div className="relative">
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 pr-12 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.9375rem] outline-none transition-all duration-200 placeholder:text-foreground/25 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--input-focus)] disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="Enter your password"
                                disabled={isSubmitting}
                            />
                            <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none text-[var(--text-muted)] cursor-pointer p-1 flex items-center transition-colors duration-200 hover:text-[var(--foreground)]"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" strokeLinecap="round" strokeLinejoin="round" />
                                        <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
                                    </svg>
                                ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
                                        <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="w-full py-3 border-none rounded-xl bg-[var(--accent)] text-white text-[0.9375rem] font-semibold cursor-pointer transition-all duration-200 flex items-center justify-center min-h-[48px] mt-1 hover:bg-[var(--accent-hover)] hover:shadow-[0_4px_20px_rgba(99,102,241,0.4)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isSubmitting || !username || !password}
                    >
                        {isSubmitting ? <Spinner size="sm" /> : 'Sign In'}
                    </button>
                </form>

                <p className="text-center text-xs text-[var(--text-muted)] mt-7 tracking-wide">
                    Delivery Partner Portal
                </p>
            </div>
        </div>
    );
}
