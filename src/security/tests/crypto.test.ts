import { describe, it, expect } from 'vitest';
import { PasswordCrypto } from '../crypto';

describe('PasswordCrypto', () => {
  describe('deriveKey', () => {
    it('derives a 32-byte key from password', () => {
      const { key, salt } = PasswordCrypto.deriveKey('test-password');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
      expect(salt).toBeInstanceOf(Buffer);
      expect(salt.length).toBe(16);
    });

    it('produces same key with same password and salt', () => {
      const { key: key1, salt } = PasswordCrypto.deriveKey('same-password');
      const { key: key2 } = PasswordCrypto.deriveKey('same-password', salt);
      expect(key1.equals(key2)).toBe(true);
    });

    it('produces different keys for different passwords', () => {
      const salt = Buffer.alloc(16, 0);
      const { key: key1 } = PasswordCrypto.deriveKey('password-a', salt);
      const { key: key2 } = PasswordCrypto.deriveKey('password-b', salt);
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('encrypt / decrypt roundtrip', () => {
    it('encrypts and decrypts with key', () => {
      const { key, salt } = PasswordCrypto.deriveKey('my-master-password');
      const plaintext = 'hello world secret data';

      const encrypted = PasswordCrypto.encrypt(plaintext, key, salt);
      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(plaintext.length);

      const decrypted = PasswordCrypto.decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts with password (re-derives key)', () => {
      const password = 'my-master-password';
      const { key, salt } = PasswordCrypto.deriveKey(password);
      const plaintext = 'secret credentials';

      const encrypted = PasswordCrypto.encrypt(plaintext, key, salt);
      const decrypted = PasswordCrypto.decrypt(encrypted, undefined, password);
      expect(decrypted).toBe(plaintext);
    });

    it('throws when decrypting with wrong key', () => {
      const { key: key1, salt } = PasswordCrypto.deriveKey('correct-password');
      const { key: key2 } = PasswordCrypto.deriveKey('wrong-password', Buffer.alloc(16, 1));

      const encrypted = PasswordCrypto.encrypt('secret', key1, salt);

      expect(() => PasswordCrypto.decrypt(encrypted, key2)).toThrow();
    });

    it('throws when no key or password provided', () => {
      const { key, salt } = PasswordCrypto.deriveKey('test');
      const encrypted = PasswordCrypto.encrypt('secret', key, salt);

      expect(() => PasswordCrypto.decrypt(encrypted)).toThrow('Must provide either key or derived password');
    });

    it('handles empty string', () => {
      const { key, salt } = PasswordCrypto.deriveKey('test');
      const encrypted = PasswordCrypto.encrypt('', key, salt);
      expect(PasswordCrypto.decrypt(encrypted, key)).toBe('');
    });

    it('handles unicode content', () => {
      const { key, salt } = PasswordCrypto.deriveKey('test');
      const plaintext = 'Héllo wörld 你好世界 🔐';
      const encrypted = PasswordCrypto.encrypt(plaintext, key, salt);
      expect(PasswordCrypto.decrypt(encrypted, key)).toBe(plaintext);
    });
  });

  describe('generatePassword', () => {
    it('generates password of specified length', () => {
      expect(PasswordCrypto.generatePassword(16).length).toBe(16);
      expect(PasswordCrypto.generatePassword(32).length).toBe(32);
    });

    it('defaults to 24 characters', () => {
      expect(PasswordCrypto.generatePassword().length).toBe(24);
    });

    it('generates different passwords each time', () => {
      const p1 = PasswordCrypto.generatePassword();
      const p2 = PasswordCrypto.generatePassword();
      expect(p1).not.toBe(p2);
    });

    it('only uses expected character set', () => {
      const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~|}{[]:;?><,./-=';
      const password = PasswordCrypto.generatePassword(100);
      for (const ch of password) {
        expect(allowed).toContain(ch);
      }
    });
  });
});
